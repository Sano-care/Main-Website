import { NextRequest, NextResponse } from "next/server";
import { getRazorpayClient, RAZORPAY_AMOUNTS } from "@/lib/razorpay";
import { getServiceHalfRoundedUp } from "@/constants/pricing";
import { t85ToPricingKey } from "@/lib/booking/serviceMapper";
import type { ServiceSlug } from "@/lib/services/catalog";

export const runtime = "nodejs";

/**
 * POST /api/razorpay/create-order
 *
 * Creates a Razorpay order. Two pricing modes:
 *
 *   1. T85 PR4a service-led (new): pass `t85Slug` = one of the 4 T85
 *      ServiceSlug values. Server computes amount as 50% of the
 *      starting price, rounded UP to nearest ₹1, via
 *      `getServiceHalfRoundedUp(t85ToPricingKey(slug))`.
 *      Examples: home-visit ₹499 → ₹250, teleconsultation ₹399 → ₹200,
 *      medic-at-home ₹199 → ₹100.
 *
 *   2. Legacy (kept): pass `serviceCategory` (legacy enum) + optional
 *      `payFull`. Server returns the flat ₹249 / ₹499 amount from
 *      RAZORPAY_AMOUNTS. Used by surfaces still wired to the T61
 *      booking modal (lab path, ops, any in-flight surfaces).
 *
 * Body:
 *   {
 *     // mode 1 (T85)
 *     t85Slug?: 'home-visit' | 'teleconsultation' | 'lab-tests' | 'medic-at-home',
 *     // mode 2 (legacy)
 *     serviceCategory?: string,
 *     payFull?: boolean,
 *   }
 *
 * Exactly one of `t85Slug` or `serviceCategory` is required.
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
      t85Slug?: ServiceSlug;
      serviceCategory?: string;
      payFull?: boolean;
    };

    const VALID_T85_SLUGS: ServiceSlug[] = [
      "home-visit",
      "teleconsultation",
      "lab-tests",
      "medic-at-home",
    ];

    let amount: number;
    let receiptToken: string;

    if (body.t85Slug && VALID_T85_SLUGS.includes(body.t85Slug)) {
      // T85 mode — service-led, server-computed 50%-rounded-up amount.
      const rupees = getServiceHalfRoundedUp(t85ToPricingKey(body.t85Slug));
      amount = rupees * 100;
      receiptToken = body.t85Slug.slice(0, 8);
    } else {
      // Legacy mode — flat ₹249 / ₹499 from RAZORPAY_AMOUNTS.
      if (
        !body.serviceCategory ||
        typeof body.serviceCategory !== "string"
      ) {
        return NextResponse.json(
          { error: "Either t85Slug or serviceCategory is required" },
          { status: 400 },
        );
      }
      amount = body.payFull
        ? RAZORPAY_AMOUNTS.FULL_VISIT_PAISE
        : RAZORPAY_AMOUNTS.BOOKING_FEE_PAISE;
      receiptToken = body.serviceCategory.slice(0, 8);
    }

    const razorpay = getRazorpayClient();

    // Receipt is a free-text identifier visible in Razorpay dashboard.
    // Must be <= 40 chars; we use a short timestamp + service code.
    const receipt = `snc_${receiptToken}_${Date.now().toString(36).slice(-8)}`;

    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt,
      notes: body.t85Slug
        ? {
            t85_slug: body.t85Slug,
            flow: "t85_50_percent",
            source: "sanocare.in/t85-service-led",
          }
        : {
            service_category: body.serviceCategory ?? "",
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
