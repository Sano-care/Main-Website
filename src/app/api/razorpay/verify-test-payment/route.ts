import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPaymentSignature } from "@/lib/razorpay";
import { isValidTokenFormat } from "@/lib/lab-tokens";

export const runtime = "nodejs";

/**
 * POST /api/razorpay/verify-test-payment
 *
 * Called by the /reports/[token] client page after Razorpay Checkout
 * succeeds. Verifies the signature, marks the booking's
 * report_payment_status = CAPTURED, and returns success so the client can
 * fetch a signed URL for the report.
 *
 * Body:
 *   {
 *     unlockToken,
 *     razorpay_order_id, razorpay_payment_id, razorpay_signature
 *   }
 *
 * Returns:
 *   200 { ok: true, signedReportUrl }   — signed URL valid 10 min for download
 *   400 { error } — bad signature, missing fields, or token mismatch
 *   500 { error }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      unlockToken,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = body || {};

    if (!isValidTokenFormat(unlockToken)) {
      return NextResponse.json(
        { error: "Invalid token format" },
        { status: 400 }
      );
    }
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json(
        { error: "Missing Razorpay payment fields" },
        { status: 400 }
      );
    }

    // === Signature verification ===
    const valid = verifyPaymentSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });
    if (!valid) {
      return NextResponse.json(
        { error: "Payment signature invalid" },
        { status: 400 }
      );
    }

    // === Look up booking by unlock token + cross-check order id ===
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
      .select("id, report_url, report_razorpay_order_id, report_payment_status")
      .eq("report_unlock_token", unlockToken)
      .single();

    if (fetchError || !booking) {
      return NextResponse.json(
        { error: "Booking not found for token" },
        { status: 404 }
      );
    }
    if (booking.report_razorpay_order_id !== razorpay_order_id) {
      return NextResponse.json(
        { error: "Order id mismatch — payment is for a different booking" },
        { status: 400 }
      );
    }

    // Mark payment captured (idempotent)
    if (booking.report_payment_status !== "CAPTURED") {
      const { error: updateError } = await supabase
        .from("bookings")
        .update({
          report_payment_status: "CAPTURED",
          report_razorpay_payment_id: razorpay_payment_id,
          report_paid_at: new Date().toISOString(),
          status: "REPORT_DELIVERED",
        })
        .eq("id", booking.id);

      if (updateError) {
        console.error(
          "[razorpay/verify-test-payment] supabase update failed:",
          updateError
        );
        return NextResponse.json(
          { error: "Payment verified but state update failed" },
          { status: 500 }
        );
      }
    }

    // === Mint a signed Supabase Storage URL for the report PDF ===
    // report_url stores the path in the 'lab-reports' bucket (e.g. 'pathcore/2026-05/booking-1234.pdf')
    let signedUrl: string | null = null;
    if (booking.report_url) {
      const { data: signed, error: signError } = await supabase.storage
        .from("lab-reports")
        .createSignedUrl(booking.report_url, 60 * 10); // 10-min window
      if (!signError && signed?.signedUrl) {
        signedUrl = signed.signedUrl;
      } else {
        console.warn(
          "[razorpay/verify-test-payment] could not sign report URL:",
          signError
        );
      }
    }

    return NextResponse.json({ ok: true, signedReportUrl: signedUrl });
  } catch (err) {
    console.error("[razorpay/verify-test-payment] error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to verify payment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
