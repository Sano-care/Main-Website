import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/pulse/booking/address-prefill
 *
 * T90 Slice 2 Step 12 — address + last-visit pre-fill for the
 * MemberConfirmStep surface (Booking Step 0).
 *
 * Query params:
 *   patient_name (optional) — when present, tries an exact-match
 *     lookup of the most recent booking under
 *     (customer_id, patient_name). Used for family-member bookings
 *     where the caregiver has previously booked for the same member.
 *   When absent (self-booking) → falls straight through to the
 *     customer's most recent any-booking address.
 *
 * Returns:
 *   200 {
 *     manual_address: string | null,
 *     last_booking_at: string | null      // ISO timestamp, only when
 *                                          // an EXACT-match booking
 *                                          // exists (for the
 *                                          // "Last visit N days ago"
 *                                          // line).
 *   }
 *   401 — no valid Pulse cookie
 *
 * Soft-fail philosophy: any DB error returns both fields null. The
 * MemberConfirmStep degrades gracefully — empty address, no last-visit
 * line, user enters address fresh. Never block a booking on this
 * pre-fill failing.
 *
 * Auth note: gates on the Pulse OTP cookie (requirePulseCustomer) —
 * not the bookingStore.phoneVerifiedUntil. Pulse session is the
 * canonical auth; the pre-fill query reads bookings scoped to the
 * authed customer.id so leakage is impossible.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const patientNameRaw = req.nextUrl.searchParams.get("patient_name");
  const patientName = patientNameRaw?.trim() || null;

  // Path 1: exact (customer_id, patient_name) match — only when we
  // have a patient_name (i.e., family-member booking).
  if (patientName) {
    const { data, error } = await supabaseAdmin
      .from("bookings")
      .select("manual_address, created_at")
      .eq("customer_id", customer.id)
      .eq("patient_name", patientName)
      .not("manual_address", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[address-prefill] exact-match query failed:", error);
      // Fall through to the customer-level fallback below.
    } else if (data?.manual_address) {
      return NextResponse.json({
        manual_address: data.manual_address as string,
        last_booking_at: (data.created_at as string) ?? null,
      });
    }
  }

  // Path 2: customer's most recent any-name booking address. Used:
  //   - for self-booking (no patient_name passed)
  //   - as fallback when no exact (customer_id, patient_name) match
  //
  // last_booking_at is intentionally NULL on this path even though
  // we have a created_at — the "Last visit N days ago" line should
  // only render when the EXACT patient has a prior booking. Showing
  // it on the fallback path would be misleading ("Mom's last visit"
  // pointing at a date when the caregiver booked for themselves).
  const { data: fallbackData, error: fallbackErr } = await supabaseAdmin
    .from("bookings")
    .select("manual_address, created_at")
    .eq("customer_id", customer.id)
    .not("manual_address", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fallbackErr) {
    console.error("[address-prefill] fallback query failed:", fallbackErr);
    return NextResponse.json({
      manual_address: null,
      last_booking_at: null,
    });
  }

  // For self-booking, last_booking_at IS the customer's most recent
  // booking timestamp — surfaces "Your last visit 12 days ago" which
  // is genuinely useful. The patientName === null branch reaches here
  // directly, so we set last_booking_at when patientName is null.
  const isSelf = patientName === null;

  return NextResponse.json({
    manual_address: (fallbackData?.manual_address as string | null) ?? null,
    last_booking_at: isSelf
      ? ((fallbackData?.created_at as string | null) ?? null)
      : null,
  });
}
