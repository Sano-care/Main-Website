import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/lab/list-coupons
 *
 * T85 PR4b — list active lab coupons for the basket's "Suggested"
 * section. Returns up to 10 active rows (newest first); client slices
 * to 3 for display.
 *
 * Why this exists as a server route (not a direct Supabase anon-key
 * query from the client component): `lab_coupons` has RLS enabled
 * but zero policies, so anon reads return empty silently. Every
 * other lab route (search, validate-coupon, create-booking-prepaid)
 * already uses the service-role key server-side — this matches that
 * pattern. PR4b's first attempt queried Supabase directly from
 * CouponSection.tsx and rendered empty; this route fixes that.
 *
 * Returns:
 *   200 { coupons: SuggestedCoupon[] }
 *   500 { error }
 *
 * `SuggestedCoupon` is the same shape the client previously computed:
 *   {
 *     code, description, minBasketInr,
 *     discountType, discountValue, maxDiscountInr
 *   }
 * Client computes `isApplicable`, `unlockDiffInr`, and
 * `potentialDiscountInr` against the live basket subtotal — those
 * change as the patient adds tests, so they don't belong in the
 * server response.
 */
export async function GET() {
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

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("lab_coupons")
    .select(
      "code, description, discount_type, discount_value, min_basket_inr, max_discount_inr, max_uses, used_count, valid_from, valid_to",
    )
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("[lab/list-coupons] supabase query failed:", error);
    return NextResponse.json(
      { error: "Could not load coupons" },
      { status: 500 },
    );
  }

  // Apply remaining filters in JS — keeps the SQL simple + avoids
  // PostgREST's awkward chained `.or()` semantics for "valid_from is
  // null OR valid_from <= now" + same for valid_to.
  const now = new Date();
  const usable = (data ?? []).filter((c) => {
    if (c.max_uses != null && c.used_count >= c.max_uses) return false;
    if (c.valid_from && new Date(c.valid_from) > now) return false;
    if (c.valid_to && new Date(c.valid_to) < now) return false;
    return true;
  });

  // Return the raw shape — client computes applicability + discount
  // against the live subtotal.
  const coupons = usable.map((c) => ({
    code: c.code as string,
    description: (c.description as string | null) ?? null,
    minBasketInr: (c.min_basket_inr as number) ?? 0,
    discountType: c.discount_type as "percent" | "flat",
    discountValue: Number(c.discount_value),
    maxDiscountInr: (c.max_discount_inr as number | null) ?? null,
  }));

  return NextResponse.json({ coupons });
}
