import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * POST /api/lab/validate-coupon
 *
 * Validates a coupon code against the current basket and returns the
 * applied discount. Does NOT increment used_count — that happens server-side
 * when the booking is created (in useBookingSubmit's lab branch).
 *
 * Body:
 *   { code: string, subtotalInr: number }
 *
 * Returns:
 *   200 { ok: true, code, discountPercent, discountInr, finalInr, description }
 *   200 { ok: false, error: "human-readable reason" }   — for UI display
 *   400 { error } / 500 { error }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const code = String(body?.code || "").trim().toUpperCase();
    const subtotalInr = Number(body?.subtotalInr);

    if (!code || code.length > 32) {
      return NextResponse.json(
        { ok: false, error: "Please enter a coupon code." },
        { status: 200 }
      );
    }
    if (!Number.isFinite(subtotalInr) || subtotalInr <= 0) {
      return NextResponse.json(
        { ok: false, error: "Add at least one test to your basket first." },
        { status: 200 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Server misconfigured" },
        { status: 500 }
      );
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: coupon, error } = await supabase
      .from("lab_coupons")
      .select(
        "code, discount_type, discount_value, min_basket_inr, max_discount_inr, max_uses, used_count, valid_from, valid_to, description, is_active"
      )
      .eq("code", code)
      .single();

    if (error || !coupon) {
      return NextResponse.json(
        { ok: false, error: "This coupon code isn't valid." },
        { status: 200 }
      );
    }
    if (!coupon.is_active) {
      return NextResponse.json(
        { ok: false, error: "This coupon is no longer active." },
        { status: 200 }
      );
    }

    const now = new Date();
    if (coupon.valid_from && new Date(coupon.valid_from) > now) {
      return NextResponse.json(
        { ok: false, error: "This coupon isn't active yet." },
        { status: 200 }
      );
    }
    if (coupon.valid_to && new Date(coupon.valid_to) < now) {
      return NextResponse.json(
        { ok: false, error: "This coupon has expired." },
        { status: 200 }
      );
    }
    if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) {
      return NextResponse.json(
        { ok: false, error: "This coupon has reached its usage limit." },
        { status: 200 }
      );
    }
    if (subtotalInr < (coupon.min_basket_inr || 0)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Minimum basket of ₹${coupon.min_basket_inr.toLocaleString(
            "en-IN"
          )} required for this coupon.`,
        },
        { status: 200 }
      );
    }

    // === Compute discount ===
    let discountInr = 0;
    let discountPercent = 0;
    if (coupon.discount_type === "percent") {
      discountPercent = Number(coupon.discount_value);
      discountInr = Math.floor((subtotalInr * discountPercent) / 100);
    } else {
      // flat
      discountInr = Number(coupon.discount_value);
      discountPercent = Math.min(
        100,
        Math.round((discountInr / subtotalInr) * 100)
      );
    }
    if (coupon.max_discount_inr != null) {
      discountInr = Math.min(discountInr, coupon.max_discount_inr);
    }
    discountInr = Math.max(0, Math.min(discountInr, subtotalInr));
    const finalInr = Math.max(0, subtotalInr - discountInr);

    return NextResponse.json({
      ok: true,
      code: coupon.code,
      discountPercent,
      discountInr,
      finalInr,
      description: coupon.description,
    });
  } catch (err) {
    console.error("[lab/validate-coupon] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
