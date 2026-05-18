import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPaymentSignature } from "@/lib/razorpay";

export const runtime = "nodejs";

/**
 * POST /api/razorpay/verify
 *
 * Called by the client after Razorpay Checkout completes successfully.
 * - Verifies the signature server-side (so we trust the payment).
 * - If valid, persists the booking to Supabase with payment fields set.
 *
 * Body:
 *   {
 *     razorpay_order_id, razorpay_payment_id, razorpay_signature,
 *     booking: { patient_name, phone, service_category, manual_address,
 *                gps_location, amount, isBookingForOther }
 *   }
 *
 * Returns:
 *   200 { ok: true, bookingId }
 *   400 { error } — signature invalid or input malformed
 *   500 { error } — Supabase or env issue
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      booking,
    } = body || {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json(
        { error: "Missing Razorpay payment fields" },
        { status: 400 }
      );
    }
    if (!booking || typeof booking !== "object") {
      return NextResponse.json({ error: "Missing booking" }, { status: 400 });
    }

    // === Signature verification ===
    const valid = verifyPaymentSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });
    if (!valid) {
      console.warn(
        "[razorpay/verify] signature mismatch for order",
        razorpay_order_id
      );
      return NextResponse.json(
        { error: "Payment signature invalid" },
        { status: 400 }
      );
    }

    // === Persist booking ===
    // We use the service-role key so this insert bypasses RLS. Patient-facing
    // bookings can also be inserted via the anon key + RLS policy; we use the
    // service role here because the *payment* has just been verified server-side
    // and we want to write the payment-status fields too.
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

    const insertPayload = {
      patient_name: String(booking.patient_name || "").trim(),
      phone: String(booking.phone || "").trim(),
      service_category: String(booking.service_category || "").trim(),
      manual_address: String(booking.manual_address || "").trim(),
      gps_location: booking.gps_location ?? null,
      amount: typeof booking.amount === "number" ? booking.amount : null,
      status: "CONFIRMED",
      // Payment fields — see migration 007_razorpay_payments.sql for schema.
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      payment_status: "CAPTURED",
      booking_fee_paid_paise: 24_900,
      payment_captured_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("bookings")
      .insert(insertPayload)
      .select("id")
      .single();

    if (error) {
      console.error("[razorpay/verify] supabase insert failed:", error);
      return NextResponse.json(
        {
          error:
            "Payment verified but booking could not be saved. Please call support.",
          razorpay_payment_id,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, bookingId: data?.id });
  } catch (err) {
    console.error("[razorpay/verify] error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to verify payment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
