import { NextRequest, NextResponse } from "next/server";
import { getRazorpayClient, RAZORPAY_AMOUNTS } from "@/lib/razorpay";

export const runtime = "nodejs";

/**
 * POST /api/razorpay/create-order
 *
 * Creates a Razorpay order for the partial-prepay booking fee (default ₹249).
 * Returns the order id + amount that the client passes to Razorpay Checkout.
 *
 * Body:
 *   { serviceCategory: string, payFull?: boolean }
 *
 * Returns:
 *   200 { orderId, amount, currency, keyId }
 *   400 { error }
 *   500 { error }
 *
 * Note: this endpoint does NOT yet write to Supabase — the booking is only
 * persisted after /api/razorpay/verify successfully validates the payment.
 * That way we never have ghost bookings for abandoned payments.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      serviceCategory?: string;
      payFull?: boolean;
    };

    if (!body.serviceCategory || typeof body.serviceCategory !== "string") {
      return NextResponse.json(
        { error: "serviceCategory is required" },
        { status: 400 }
      );
    }

    // Default to the ₹249 booking fee; allow opt-in to full ₹499 upfront.
    // Lab samples are free at booking (the lab tests are billed separately
    // by the lab partner), so we still capture a small refundable hold.
    const amount = body.payFull
      ? RAZORPAY_AMOUNTS.FULL_VISIT_PAISE
      : RAZORPAY_AMOUNTS.BOOKING_FEE_PAISE;

    const razorpay = getRazorpayClient();

    // Receipt is a free-text identifier visible in Razorpay dashboard.
    // Must be <= 40 chars; we use a short timestamp + service code.
    const receipt = `snc_${body.serviceCategory.slice(0, 8)}_${Date.now()
      .toString(36)
      .slice(-8)}`;

    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt,
      notes: {
        service_category: body.serviceCategory,
        flow: body.payFull ? "full_upfront" : "partial_prepay",
        source: "sanocare.in/hero-booking",
      },
    });

    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("[razorpay/create-order] error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to create order";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
