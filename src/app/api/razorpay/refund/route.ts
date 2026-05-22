import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { issueRefund, RefundError, type PaymentKind } from "@/lib/razorpay-refund";

export const runtime = "nodejs";

/**
 * POST /api/razorpay/refund — legacy token-protected refund endpoint.
 *
 * Kept alive for existing Postman / curl scripts and any infra automation
 * that integrated with it pre-M3. The new in-app refund flow lives at
 * /ops/payments and uses the same underlying issueRefund() helper, so
 * there is exactly one refund implementation across the codebase.
 *
 * This route's contract has NOT changed for callers — same body, same
 * response shape, same auth header. The legacy "homecare must be in
 * PENDING/CONFIRMED" pre-check is preserved for backward compat. The
 * lab-cancellation-without-payment branch (returns kind:'no_payment')
 * is also preserved.
 *
 * Flag for M7 hardening: this route uses a shared bearer token (no
 * per-user attribution, no rate limit). The new ops admin path is the
 * preferred channel.
 *
 * Body:
 *   { bookingId: string, reason?: string, partialAmountPaise?: number }
 * Auth: `x-ops-token` header must match OPS_API_TOKEN env var.
 *
 * Returns:
 *   200 { ok: true, refundId, refundedAmountPaise, kind }
 *   200 { ok: true, kind: 'no_payment', message }  — lab cancel-before-pay
 *   400 / 401 / 404 / 500 with { error }
 */
export async function POST(req: NextRequest) {
  try {
    const opsToken = req.headers.get("x-ops-token");
    const expected = process.env.OPS_API_TOKEN;
    if (!expected || opsToken !== expected) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }

    const body = await req.json();
    const { bookingId, reason, partialAmountPaise } = body || {};

    if (!bookingId || typeof bookingId !== "string") {
      return NextResponse.json(
        { error: "bookingId is required" },
        { status: 400 },
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Supabase server credentials missing" },
        { status: 500 },
      );
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // ---- Legacy pre-checks (preserved) ----
    // The original endpoint enforced these business rules before calling
    // Razorpay. Keeping them intact so existing automation behaves the
    // same way; the ops admin UI path skips them deliberately (admin
    // override).
    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select(
        "id, status, service_category, razorpay_payment_id, payment_status, report_razorpay_payment_id, report_payment_status",
      )
      .eq("id", bookingId)
      .single();
    if (fetchError || !booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    let paymentKind: PaymentKind;
    if (booking.service_category === "diagnostics") {
      if (
        booking.report_payment_status === "CAPTURED" &&
        booking.report_razorpay_payment_id
      ) {
        paymentKind = "report_fee";
      } else if (
        booking.status === "PENDING_COLLECTION" ||
        booking.status === "COLLECTED" ||
        booking.status === "AT_LAB"
      ) {
        // No payment captured yet — original behaviour: just cancel.
        const { error: cancelError } = await supabase
          .from("bookings")
          .update({ status: "CANCELLED", report_payment_status: null })
          .eq("id", bookingId);
        if (cancelError) {
          return NextResponse.json(
            { error: "Failed to cancel booking" },
            { status: 500 },
          );
        }
        return NextResponse.json({
          ok: true,
          kind: "no_payment",
          message:
            "Lab booking cancelled. No payment to refund (test cost was never charged).",
        });
      } else {
        return NextResponse.json(
          { error: "Lab booking is not in a refundable state. Status: " + booking.status },
          { status: 400 },
        );
      }
    } else {
      if (booking.status !== "PENDING" && booking.status !== "CONFIRMED") {
        return NextResponse.json(
          {
            error:
              "Refund not allowed once a medic has been dispatched. Status: " +
              booking.status,
          },
          { status: 400 },
        );
      }
      if (
        booking.payment_status !== "CAPTURED" ||
        !booking.razorpay_payment_id
      ) {
        return NextResponse.json(
          { error: "Booking fee was not captured — nothing to refund" },
          { status: 400 },
        );
      }
      paymentKind = "booking_fee";
    }

    // ---- Delegate to the shared implementation ----
    try {
      const result = await issueRefund(supabase, {
        bookingId,
        paymentKind,
        reason: reason || null,
        partialAmountPaise:
          typeof partialAmountPaise === "number" ? partialAmountPaise : null,
        opsUserId: null, // legacy token route has no session attribution
      });

      // For homecare booking-fee refunds the legacy contract also moved
      // the booking to CANCELLED — preserve that side-effect here, since
      // issueRefund() itself doesn't touch booking lifecycle.
      if (paymentKind === "booking_fee") {
        await supabase
          .from("bookings")
          .update({ status: "CANCELLED" })
          .eq("id", bookingId);
      }

      return NextResponse.json({
        ok: true,
        refundId: result.refundId,
        refundedAmountPaise: result.refundedAmountPaise,
        kind: paymentKind,
      });
    } catch (e) {
      if (e instanceof RefundError) {
        const status = e.code === "db_write_failed" ? 500 : 400;
        return NextResponse.json({ error: e.message }, { status });
      }
      throw e;
    }
  } catch (err) {
    console.error("[razorpay/refund] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Refund failed" },
      { status: 500 },
    );
  }
}
