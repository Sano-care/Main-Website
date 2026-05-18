import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRazorpayClient } from "@/lib/razorpay";
import { generateReportUnlockToken } from "@/lib/lab-tokens";

export const runtime = "nodejs";

/**
 * POST /api/lab/send-report-payment-link
 *
 * Called by the ops team (via the /ops/lab dashboard) when the partner lab
 * has finalised the report.
 *
 * Workflow:
 *   1. Ops uploads the report PDF to Supabase Storage bucket 'lab-reports'
 *      (separate flow; this endpoint just takes the storage path).
 *   2. Ops calls this endpoint with the booking id + storage path.
 *   3. Server creates a Razorpay order for the locked-in test total, generates
 *      a 32-char unlock token, persists both on the booking row, and returns a
 *      payment link the ops team can WhatsApp/SMS to the patient.
 *
 * Body:
 *   { bookingId: string, reportStoragePath: string }
 *
 * Returns:
 *   200 { ok: true, paymentLink, unlockToken, testTotalPaise, razorpayOrderId }
 *   400 { error }
 *   500 { error }
 *
 * Auth:
 *   Requires the OPS_API_TOKEN header. Set OPS_API_TOKEN in Netlify env vars
 *   to a long random string; share with the ops team only.
 */
export async function POST(req: NextRequest) {
  try {
    // Simple bearer-token auth for the ops dashboard. Don't expose this
    // endpoint to the public internet without rotating the token after
    // every ops handover.
    const opsToken = req.headers.get("x-ops-token");
    const expected = process.env.OPS_API_TOKEN;
    if (!expected || opsToken !== expected) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }

    const body = await req.json();
    const { bookingId, reportStoragePath } = body || {};

    if (!bookingId || typeof bookingId !== "string") {
      return NextResponse.json(
        { error: "bookingId is required" },
        { status: 400 }
      );
    }
    if (!reportStoragePath || typeof reportStoragePath !== "string") {
      return NextResponse.json(
        { error: "reportStoragePath is required" },
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

    // Fetch the booking, including any coupon snapshot taken at booking time
    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select(
        "id, service_category, selected_tests, status, applied_coupon_code, coupon_discount_paise, final_amount_paise, test_total_paise"
      )
      .eq("id", bookingId)
      .single();

    if (fetchError || !booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }
    if (booking.service_category !== "diagnostics") {
      return NextResponse.json(
        { error: "Not a lab/diagnostics booking" },
        { status: 400 }
      );
    }
    if (!booking.selected_tests || !Array.isArray(booking.selected_tests)) {
      return NextResponse.json(
        { error: "No tests selected on this booking" },
        { status: 400 }
      );
    }

    // Re-compute the subtotal server-side (don't trust the snapshot blindly)
    const subtotalRupees = booking.selected_tests.reduce(
      (sum: number, t: { price?: number }) =>
        sum + (typeof t.price === "number" ? t.price : 0),
      0
    );
    if (subtotalRupees <= 0) {
      return NextResponse.json(
        { error: "Test total is zero — refusing to create a ₹0 order" },
        { status: 400 }
      );
    }
    const subtotalPaise = subtotalRupees * 100;

    // Use the stored final_amount_paise (which already reflects any coupon
    // discount applied at booking time). If for some reason it's null/zero,
    // fall back to the recomputed subtotal.
    let finalPaise = booking.final_amount_paise ?? subtotalPaise;
    if (finalPaise <= 0) finalPaise = subtotalPaise;
    // Razorpay minimum order is ₹1 (100 paise). If a 100%-off coupon was
    // applied, charge ₹1 as a token capture (or you can skip the payment
    // step entirely — for v1 we keep the magic-link flow uniform).
    if (finalPaise < 100) finalPaise = 100;

    const testTotalPaise = finalPaise; // legacy var name preserved below

    // Create the Razorpay order for the test total
    const razorpay = getRazorpayClient();
    const order = await razorpay.orders.create({
      amount: testTotalPaise,
      currency: "INR",
      receipt: `lab_${bookingId.slice(0, 8)}_${Date.now().toString(36).slice(-6)}`,
      notes: {
        booking_id: bookingId,
        flow: "lab_report_payment",
        partner_lab: "pathcore",
        coupon: booking.applied_coupon_code || "none",
        subtotal_paise: String(subtotalPaise),
      },
    });

    // Increment coupon used_count atomically (best-effort; non-blocking).
    // We do this here (at link-send time) rather than at booking time so a
    // patient who never pays doesn't permanently burn a use slot.
    if (booking.applied_coupon_code) {
      const { error: rpcError } = await supabase.rpc(
        "increment_coupon_usage",
        { coupon_code: booking.applied_coupon_code }
      );
      if (rpcError) {
        // RPC may not exist; fall back to a manual update. Failure here is
        // non-fatal — we'd rather send the payment link than block on the coupon
        // counter, so we log and continue.
        const { data: couponRow } = await supabase
          .from("lab_coupons")
          .select("used_count")
          .eq("code", booking.applied_coupon_code)
          .single();
        if (couponRow) {
          await supabase
            .from("lab_coupons")
            .update({ used_count: (couponRow.used_count ?? 0) + 1 })
            .eq("code", booking.applied_coupon_code);
        } else {
          console.warn(
            "[lab/send-link] coupon counter not incremented:",
            booking.applied_coupon_code,
            rpcError.message
          );
        }
      }
    }

    // Generate the unlock token and persist everything on the booking
    const unlockToken = generateReportUnlockToken();
    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
      "https://sanocare.in";
    const paymentLink = `${baseUrl}/reports/${unlockToken}`;

    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        status: "AWAITING_PAYMENT",
        report_url: reportStoragePath,
        report_uploaded_at: new Date().toISOString(),
        report_unlock_token: unlockToken,
        report_payment_status: "LINK_SENT",
        report_razorpay_order_id: order.id,
        report_payment_link_sent_at: new Date().toISOString(),
        test_total_paise: testTotalPaise,
      })
      .eq("id", bookingId);

    if (updateError) {
      console.error("[lab/send-link] supabase update failed:", updateError);
      return NextResponse.json(
        { error: "Failed to persist payment link state" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      bookingId,
      paymentLink,
      unlockToken,
      testTotalPaise,
      subtotalPaise,
      couponCode: booking.applied_coupon_code || null,
      razorpayOrderId: order.id,
    });
  } catch (err) {
    console.error("[lab/send-report-payment-link] error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to send payment link";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
