import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRazorpayClient, RAZORPAY_AMOUNTS } from "@/lib/razorpay";
import { getServiceHalfRoundedUp } from "@/constants/pricing";
import { t85ToPricingKey } from "@/lib/booking/serviceMapper";
import { LAB_COLLECTION_FEE_INR } from "@/lib/services/labCatalog";
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
      kind?: "lab-prepaid";
      t85Slug?: ServiceSlug;
      serviceCategory?: string;
      payFull?: boolean;
      // PR4b lab-prepaid fields
      subtotalInr?: number;
      couponCode?: string;
      // T85 PR4b v2 — payment mode. 'full' = full grand total via
      // Razorpay; 'partial' = ₹200 collection fee via Razorpay (balance
      // collected at door via UPI). Defaults to 'full' for back-compat
      // with any client that doesn't yet pass the field.
      paymentMode?: "full" | "partial";
    };

    const VALID_T85_SLUGS: ServiceSlug[] = [
      "home-visit",
      "teleconsultation",
      "lab-tests",
      "medic-at-home",
    ];

    let amount: number;
    let receiptToken: string;
    // Server-computed lab amount components — surfaced back in `notes`
    // so the verify route doesn't have to re-derive them.
    let labBreakdown: {
      subtotalInr: number;
      discountInr: number;
      collectionFeeInr: number;
      grandTotalInr: number;
      couponCode: string | null;
    } | null = null;

    if (body.kind === "lab-prepaid") {
      // === T85 PR4b — lab-prepaid mode ===
      // Server re-validates coupon and computes grand total. Never
      // trust the client's `grandTotalInr` — patient could tamper with
      // form state to under-charge themselves. We accept subtotal +
      // coupon code + paymentMode, validate everything, and emit a
      // server-authoritative amount.
      const subtotalInr = Number(body.subtotalInr);
      if (!Number.isFinite(subtotalInr) || subtotalInr <= 0) {
        return NextResponse.json(
          { error: "subtotalInr required and must be > 0 for lab-prepaid" },
          { status: 400 },
        );
      }
      // T85 PR4b v2 — paymentMode dispatch. 'full' is the default for
      // back-compat with clients that don't yet pass the field.
      const paymentMode =
        body.paymentMode === "partial" ? "partial" : "full";
      const couponCode =
        typeof body.couponCode === "string" && body.couponCode.trim().length > 0
          ? body.couponCode.trim().toUpperCase()
          : null;

      let discountInr = 0;
      // Coupons apply to Mode A (full) only. In Mode B the prepaid
      // amount is a flat ₹200 collection fee; the test-side balance
      // (which a coupon would discount) is collected at the door so
      // any coupon discount applies at collection time, not at
      // booking-side Razorpay capture. For PR4b v2 simplicity we
      // ignore the coupon in Mode B — patient still sees the
      // promised discount land in the basket math, but it doesn't
      // reduce the ₹200 they pay now.
      if (couponCode && paymentMode === "full") {
        // Inline coupon revalidation — mirrors `/api/lab/validate-coupon`
        // logic but on the server-trusted subtotal we just received.
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceRoleKey) {
          return NextResponse.json(
            { error: "Server misconfigured" },
            { status: 500 },
          );
        }
        const supabase = createClient(supabaseUrl, serviceRoleKey, {
          auth: { persistSession: false },
        });
        const { data: coupon } = await supabase
          .from("lab_coupons")
          .select(
            "discount_type, discount_value, min_basket_inr, max_discount_inr, max_uses, used_count, valid_from, valid_to, is_active",
          )
          .eq("code", couponCode)
          .single();

        const now = new Date();
        const valid =
          coupon &&
          coupon.is_active &&
          subtotalInr >= (coupon.min_basket_inr ?? 0) &&
          (coupon.max_uses == null || coupon.used_count < coupon.max_uses) &&
          (!coupon.valid_from || new Date(coupon.valid_from) <= now) &&
          (!coupon.valid_to || new Date(coupon.valid_to) >= now);

        if (valid) {
          if (coupon.discount_type === "percent") {
            discountInr = Math.floor(
              (subtotalInr * Number(coupon.discount_value)) / 100,
            );
          } else {
            discountInr = Number(coupon.discount_value);
          }
          if (coupon.max_discount_inr != null) {
            discountInr = Math.min(discountInr, coupon.max_discount_inr);
          }
          discountInr = Math.max(0, Math.min(discountInr, subtotalInr));
        }
        // Silently fall through on invalid coupon — the basket UI
        // shows the validation error before submit; if a tampered
        // request reaches here, just charge full amount. No partial
        // failure.
      }

      const fullGrandTotalInr = Math.max(
        0,
        Math.ceil(subtotalInr - discountInr + LAB_COLLECTION_FEE_INR),
      );
      // Mode A bills the full grand total; Mode B bills the ₹200
      // collection fee. Balance for Mode B = full grand total − 200,
      // captured at the door via UPI (no Razorpay event).
      const billedNowInr =
        paymentMode === "full" ? fullGrandTotalInr : LAB_COLLECTION_FEE_INR;
      amount = billedNowInr * 100;
      receiptToken = paymentMode === "full" ? "lab" : "labp";
      labBreakdown = {
        subtotalInr,
        discountInr,
        collectionFeeInr: LAB_COLLECTION_FEE_INR,
        grandTotalInr: fullGrandTotalInr,
        couponCode,
      };
    } else if (body.t85Slug && VALID_T85_SLUGS.includes(body.t85Slug)) {
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
          { error: "Either kind/t85Slug/serviceCategory is required" },
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

    // Razorpay typings demand a `Record<string, string | number>` for
    // notes — no `undefined` values, no optional fields. Build a plain
    // string-only map up front so TypeScript narrows correctly.
    const orderNotes: Record<string, string> = labBreakdown
      ? {
          flow: "t85_lab_prepaid",
          payment_mode: body.paymentMode === "partial" ? "partial" : "full",
          source: "sanocare.in/t85-lab-basket",
          subtotal_inr: String(labBreakdown.subtotalInr),
          discount_inr: String(labBreakdown.discountInr),
          collection_fee_inr: String(labBreakdown.collectionFeeInr),
          grand_total_inr: String(labBreakdown.grandTotalInr),
          coupon_code: labBreakdown.couponCode ?? "",
        }
      : body.t85Slug
        ? {
            t85_slug: body.t85Slug,
            flow: "t85_50_percent",
            source: "sanocare.in/t85-service-led",
          }
        : {
            service_category: body.serviceCategory ?? "",
            flow: body.payFull ? "full_upfront" : "partial_prepay",
            source: "sanocare.in/hero-booking",
          };

    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt,
      notes: orderNotes,
    });

    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      // T85 PR4b — echo back the lab breakdown so the client can show
      // a final-confirmation toast if the server re-priced the coupon.
      labBreakdown,
    });
  } catch (err) {
    console.error("[razorpay/create-order] error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to create order";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
