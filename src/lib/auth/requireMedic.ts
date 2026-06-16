// T65 Phase 1 — medic API authentication middleware.
//
// Mirrors `requirePulseCustomer` (T90 Slice 1): reads the medic verify
// cookie, validates the HMAC + kind discriminator + UUID shape via
// verifyMedicToken, and — for sliding-renewal tokens — re-mints the
// cookie with a fresh exp on every authenticated hit.
//
// Returns a NextResponse (401) on failure so callers stay terse:
//
//   const auth = await requireMedic(request);
//   if (auth instanceof NextResponse) return auth;
//   // auth: { medic_id, phone, staySignedIn }
//
// The sliding-renewal write keeps the long-TTL session truly long-TTL
// even when the medic uses the app every day for a year — without
// renewal, the 1-year exp would only ever be set at OTP time, then
// strictly decrement.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  MEDIC_COOKIE_NAME,
  PULSE_LONG_TTL_SECONDS,
  medicCookieOptions,
  renewMedicToken,
  verifyMedicToken,
} from "@/lib/otp/token";

export interface VerifiedMedic {
  medic_id: string;
  phone: string;
  staySignedIn: boolean;
}

/**
 * Validates the medic verify cookie. On success, mutates the cookie via
 * `cookies().set()` to extend the exp by another long-TTL window when
 * staySignedIn=true. Server Actions / Route Handlers both pick up the
 * Set-Cookie on the response automatically.
 *
 * Returns a 401 NextResponse on any failure so the caller can `return`
 * it directly.
 */
export async function requireMedic(
  request: NextRequest,
): Promise<VerifiedMedic | NextResponse> {
  const cookie = request.cookies.get(MEDIC_COOKIE_NAME)?.value;
  const verified = verifyMedicToken(cookie);
  if (!verified) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Sliding renewal — only for long-TTL sessions. Session cookies
  // (staySignedIn=false) keep their short TTL by design.
  if (verified.staySignedIn) {
    try {
      const renewed = renewMedicToken(verified);
      const cookieStore = await cookies();
      cookieStore.set({
        name: MEDIC_COOKIE_NAME,
        value: renewed,
        ...medicCookieOptions(PULSE_LONG_TTL_SECONDS),
      });
    } catch (err) {
      // Renewal is best-effort — the current cookie is still valid for
      // its remaining TTL. Log + proceed.
      console.error("[requireMedic] sliding-renewal write failed", err);
    }
  }

  return {
    medic_id: verified.medic_id,
    phone: verified.phone,
    staySignedIn: verified.staySignedIn,
  };
}
