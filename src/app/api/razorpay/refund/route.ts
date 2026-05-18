import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRazorpayClient } from "@/lib/razorpay";

export const runtime = "nodejs";

/**
 * POST /api/razorpay/refund
 *
 * Ops endpoint to refund a Razorpay payment tied to a booking.
 *
 * Two refund flows:
 *
 *   A. Booking-fee refund (home/nursing/teleconsult, before medic dispatch)
 *      — refunds the ₹249 partial-prepay captured at booking time.
 *      Allowed only while status is PENDING or CONFIRMED. Per CP3 policy.
 *
 *   B. Report-fee refund (lab tests, after report payment captured)
 *      — full refund of the test cost. Use when a sample was rejected by
 *      Pathcore or the patient disputes a charge.
 *
 * Body:
 *   { bookingId: string, reason?: string, partialAmountPaise?: number }
 *
 * Auth: `x-ops-token` header must match OPS_API_TOKEN env var.
 *
 * Returns:
 *   200 { ok: true, refundId, refundedAmountPaise, kind: "booking_fee" | "report_fee" }
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
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Supabase server credentials missing" },
        { status: 500 }
      );
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select(
        "id, status, service_category, razorpay_payment_id, payment_status, booking_fee_paid_paise, report_razorpay_payment_id, report_payment_status, final_amount_paise, test_total_paise"
      )
      .eq("id", bookingId)
      .single();

    if (fetchError || !booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    // === Determine which refund flow applies ===
    let kind: "booking_fee" | "report_fee" | null = null;
    let paymentId: string | null = null;
    let refundablePaise = 0;

    if (booking.service_category === "diagnostics") {
      // Lab booking — refund the report payment (only if captured)
      if (booking.report_payment_status === "CAPTURED" && booking.report_razorpay_payment_id) {
        kind = "report_fee";
        paymentId = booking.report_razorpay_payment_id;
        refundablePaise =
          booking.final_amount_paise || booking.test_total_paise || 0;
      } else if (
        booking.status === "PENDING_COLLECTION" ||
        booking.status === "COLLECTED" ||
        booking.status === "AT_LAB"
      ) {
        // Lab booking with no payment captured yet — just cancel, nothing to refund
        const { error: cancelError } = await supabase
          .from("bookings")
          .update({ status: "CANCELLED", report_payment_status: null })
          .eq("id", bookingId);
        if (cancelError) {
          return NextResponse.json(
            { error: "Failed to cancel booking" },
            { status: 500 }
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
          {
            error:
              "Lab booking is not in a refundable state. Status: " +
              booking.status,
          },
          { status: 400 }
        );
      }
    } else {
      // Home/nursing/teleconsult booking — refund the ₹249 booking fee
      if (
        booking.status !== "PENDING" &&
        booking.status !== "CONFIRMED"
      ) {
        return NextResponse.json(
          {
            error:
              "Refund not allowed once a medic has been dispatched. Status: " +
              booking.status,
          },
          { status: 400 }
        );
      }
      if (
        booking.payment_status !== "CAPTURED" ||
        !booking.razorpay_payment_id
      ) {
        return NextResponse.json(
          { error: "Booking fee was not captured — nothing to refund" },
          { status: 400 }
        );
      }
      kind = "booking_fee";
      paymentId = booking.razorpay_payment_id;
      refundablePaise = booking.booking_fee_paid_paise || 24_900;
    }

    if (!kind || !paymentId) {
      return NextResponse.json(
        { error: "Could not determine refund kind" },
        { status: 400 }
      );
    }

    // === Compute refund amount (full unless partial requested + valid) ===
    let refundPaise = refundablePaise;
    if (typeof partialAmountPaise === "number" && partialAmountPaise > 0) {
      if (partialAmountPaise > refundablePaise) {
        return NextResponse.json(
          {
            error:
              "partialAmountPaise exceeds the captured payment amount",
          },
          { status: 400 }
        );
      }
      refundPaise = partialAmountPaise;
    }

    // === Call Razorpay refund API ===
    const razorpay = getRazorpayClient();
    const refund = await razorpay.payments.refund(paymentId, {
      amount: refundPaise,
      speed: "normal", // 'optimum' is instant for eligible methods + a small fee
      notes: {
        booking_id: bookingId,
        reason: reason || "Cancellation per Sanocare refund policy",
        kind,
      },
    });

    // === Persist refund state on the booking ===
    const isPartial = refundPaise < refundablePaise;
    const newPaymentStatus = isPartial ? "PARTIAL_REFUND" : "REFUNDED";

    const updates: Record<string, unknown> = {
      refund_id: refund.id,
      refunded_at: new Date().toISOString(),
      refund_amount_paise: refundPaise,
    };
    if (kind === "booking_fee") {
      updates.payment_status = newPaymentStatus;
      updates.status = "CANCELLED";
    } else {
      updates.report_payment_status = newPaymentStatus;
      // Don't move status off REPORT_DELIVERED — patient may have already
      // downloaded the report; refund is a financial-only event.
    }

    const { error: updateError } = await supabase
      .from("bookings")
      .update(updates)
      .eq("id", bookingId);

    if (updateError) {
      // Refund was created at Razorpay; persistence failed. Important to log
      // loudly because we now have an out-of-sync state requiring manual fix.
      console.error(
        "[razorpay/refund] CRITICAL: refund created at Razorpay but DB update failed",
        { bookingId, refundId: refund.id, error: updateError }
      );
      return NextResponse.json(
        {
          error:
            "Refund initiated at Razorpay but booking state failed to update. Check Razorpay dashboard for refund " +
            refund.id +
            " and reconcile manually.",
          refundId: refund.id,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      refundId: refund.id,
      refundedAmountPaise: refundPaise,
      kind,
    });
  } catch (err) {
    console.error("[razorpay/refund] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Refund failed" },
      { status: 500 }
    );
  }
}
