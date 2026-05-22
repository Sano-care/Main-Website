import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";

/**
 * POST /api/razorpay/webhook
 *
 * Webhook endpoint Razorpay calls server-to-server when payment / refund
 * events occur. We use this as a **safety net** alongside the synchronous
 * client callbacks (/api/razorpay/verify, /api/razorpay/verify-test-payment)
 * so payment state stays consistent even if the client never returns.
 *
 * Events we handle:
 *   - payment.captured      → ensure booking has payment_status = CAPTURED
 *   - payment.failed        → log only (booking never persisted in our flow)
 *   - refund.processed      → update refund_id / refunded_at / refund_amount
 *   - refund.failed         → log + flag for ops attention
 *
 * Configure in Razorpay Dashboard → Webhooks:
 *   URL:    https://sanocare.in/api/razorpay/webhook
 *   Secret: long random string; also set as env var RAZORPAY_WEBHOOK_SECRET
 *   Events: payment.captured, payment.failed, refund.processed, refund.failed
 *
 * Returns:
 *   200 { ok: true } — always, unless signature invalid
 *   400 / 500 with { error }
 *
 * IMPORTANT: Razorpay considers anything other than 2xx as a delivery failure
 * and will retry. Always return 200 if we processed (or chose to ignore) the
 * event — even if our DB write fails, log loudly and return 200 so we don't
 * get flooded with retries for the same event.
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature");

    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      console.error(
        "[razorpay/webhook] RAZORPAY_WEBHOOK_SECRET not configured"
      );
      return NextResponse.json(
        { error: "Webhook secret not configured" },
        { status: 500 }
      );
    }
    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    // Verify webhook signature
    const expected = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    const sigBuf = Buffer.from(signature, "utf8");
    const expBuf = Buffer.from(expected, "utf8");
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      console.warn("[razorpay/webhook] signature mismatch");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const event = JSON.parse(rawBody);
    const eventType: string = event?.event || "";
    const eventId: string = event?.id || "";
    console.info("[razorpay/webhook] received", { eventType, eventId });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // === Event router ===
    if (eventType === "payment.captured") {
      const payment = event?.payload?.payment?.entity;
      const paymentId = payment?.id as string | undefined;
      const orderId = payment?.order_id as string | undefined;
      const notes = (payment?.notes || {}) as Record<string, string>;
      const flow = notes.flow;

      if (!paymentId || !orderId) {
        console.warn("[webhook payment.captured] missing payment/order id");
        return NextResponse.json({ ok: true });
      }

      // Match by order id — that's our cross-reference column.
      // For lab report payments, the order id lives in report_razorpay_order_id.
      // For booking-fee payments, it lives in razorpay_order_id.
      if (flow === "lab_report_payment") {
        await supabase
          .from("bookings")
          .update({
            report_razorpay_payment_id: paymentId,
            report_payment_status: "CAPTURED",
            report_paid_at: new Date().toISOString(),
            status: "REPORT_DELIVERED",
          })
          .eq("report_razorpay_order_id", orderId)
          .neq("report_payment_status", "CAPTURED"); // idempotent
      } else {
        await supabase
          .from("bookings")
          .update({
            razorpay_payment_id: paymentId,
            payment_status: "CAPTURED",
            payment_captured_at: new Date().toISOString(),
          })
          .eq("razorpay_order_id", orderId)
          .neq("payment_status", "CAPTURED");
      }

      return NextResponse.json({ ok: true });
    }

    if (eventType === "payment.failed") {
      // We don't persist failed-payment bookings (the synchronous flow
      // never creates a bookings row on failure). Just log and ack.
      console.info(
        "[webhook payment.failed]",
        event?.payload?.payment?.entity?.id
      );
      return NextResponse.json({ ok: true });
    }

    if (
      eventType === "refund.processed" ||
      eventType === "refund.created" ||
      eventType === "refund.failed"
    ) {
      const refund = event?.payload?.refund?.entity;
      const refundId = refund?.id as string | undefined;
      const paymentId = refund?.payment_id as string | undefined;
      const amount = (refund?.amount as number) || 0;
      const failed = eventType === "refund.failed";
      // Razorpay sends 'pending' for refund.created on slower banks,
      // 'processed' on refund.processed, and we map refund.failed to
      // our 'failed' state.
      const refundsStatus: "pending" | "processed" | "failed" = failed
        ? "failed"
        : eventType === "refund.processed"
          ? "processed"
          : "pending";

      if (failed) {
        console.error(
          "[webhook refund.failed] needs ops attention",
          refund?.id,
          refund?.error_code,
          refund?.error_description,
        );
      }

      if (!refundId || !paymentId) {
        return NextResponse.json({ ok: true });
      }

      // ---- Find which booking + lane this refund belongs to ----
      // Single round-trip with PostgREST's `or()`. The UNIQUE constraint
      // added in M018 guarantees at most one match per lane.
      const { data: bookingMatch } = await supabase
        .from("bookings")
        .select("id, razorpay_payment_id, report_razorpay_payment_id")
        .or(
          `razorpay_payment_id.eq.${paymentId},report_razorpay_payment_id.eq.${paymentId}`,
        )
        .maybeSingle();

      if (bookingMatch) {
        const kind: "booking_fee" | "report_fee" =
          bookingMatch.razorpay_payment_id === paymentId
            ? "booking_fee"
            : "report_fee";

        // Upsert the refunds row by razorpay_refund_id. Covers all four
        // origins symmetrically:
        //   - dashboard-issued refund -> webhook is the only writer (INSERT)
        //   - ops UI -> refunds row already exists, webhook updates status
        //   - legacy token route -> same as ops UI
        //   - race / replay -> ON CONFLICT collapses to a single row
        const { error: upsertErr } = await supabase
          .from("refunds")
          .upsert(
            {
              razorpay_refund_id: refundId,
              booking_id: bookingMatch.id,
              payment_kind: kind,
              amount_paise: amount,
              status: refundsStatus,
              reason: refund?.notes?.reason ?? null,
              // created_by intentionally NOT set here. Either the
              // earlier INSERT (ops action) already set it, or it stays
              // NULL because this refund originated outside the app.
            },
            { onConflict: "razorpay_refund_id" },
          );
        if (upsertErr) {
          console.error(
            "[webhook refund] refunds upsert failed",
            refundId,
            upsertErr,
          );
        }
      } else {
        console.warn(
          "[webhook refund] no booking matches paymentId",
          paymentId,
          "refundId",
          refundId,
        );
      }

      // ---- Legacy bookings mirror — unchanged behaviour ----
      // Even on refund.failed we DON'T flip bookings.payment_status, since
      // a failed refund means the original capture is still good. Only
      // processed/created refunds update the bookings inline mirror.
      if (!failed) {
        await supabase
          .from("bookings")
          .update({
            refund_id: refundId,
            refunded_at: new Date().toISOString(),
            refund_amount_paise: amount,
            payment_status: "REFUNDED",
          })
          .eq("razorpay_payment_id", paymentId);

        await supabase
          .from("bookings")
          .update({
            refund_id: refundId,
            refunded_at: new Date().toISOString(),
            refund_amount_paise: amount,
            report_payment_status: "REFUNDED",
          })
          .eq("report_razorpay_payment_id", paymentId);
      }

      return NextResponse.json({ ok: true });
    }

    // Unknown event — ack so Razorpay doesn't retry
    console.info("[razorpay/webhook] unhandled event type:", eventType);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[razorpay/webhook] error:", err);
    // Still ack — we'd rather lose an event than get spammed with retries
    return NextResponse.json({ ok: true, warning: "error logged" });
  }
}
