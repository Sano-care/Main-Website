import { NextRequest, NextResponse } from "next/server";

import { validatePatientName } from "@/lib/booking/customerLink";
import {
  PULSE_LONG_TTL_SECONDS,
  VERIFY_COOKIE_NAME,
  mintVerificationToken,
  pulseCookieOptions,
  verifyToken,
} from "@/lib/otp/token";
import { supabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * POST /api/auth/stay-signed-in-preference
 *
 * Re-issues the Pulse OTP-verify cookie with a new `staySignedIn` flag
 * AND (optionally) captures the user's full name. Driven by the
 * welcome-page Step 1 surface (T90 Step 09 + patch 1):
 *
 *   1. "Stay signed in on this phone" checkbox — the deliberate
 *      consent toggle. Applied server-side so the cookie's Max-Age +
 *      the token's exp field both reflect the actual choice.
 *   2. "What should we call you?" name input — first-Pulse-signin
 *      name capture (patch 1, 2026-06-12). Validates via the same
 *      `validatePatientName` helper used by the booking flow so the
 *      placeholder + length rules stay consistent app-wide.
 *
 * Body:
 *   {
 *     stay_signed_in: boolean,                // required
 *     full_name?: string | null               // optional
 *   }
 * Auth: requires a valid OTP verify cookie (just signed in via OTP).
 *
 * Returns:
 *   204 No Content — cookie re-set on response (name PATCH soft-fails
 *                    silently if it errors after passing validation)
 *   400 { error }  — invalid body shape OR name failed validation
 *   401 { error }  — no valid verify cookie (sign in again)
 *
 * Idempotent for the cookie re-issue. Name PATCH overwrites whatever
 * value was previously on customers.full_name (acceptable — this is
 * the user's deliberate "call me X" surface).
 */
export async function POST(req: NextRequest) {
  let body: { stay_signed_in?: unknown; full_name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.stay_signed_in !== "boolean") {
    return NextResponse.json(
      { error: "stay_signed_in must be a boolean." },
      { status: 400 },
    );
  }
  const staySignedIn = body.stay_signed_in;

  const token = req.cookies.get(VERIFY_COOKIE_NAME)?.value;
  const verified = verifyToken(token);
  if (!verified) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }

  // Patch 1 (2026-06-12): optional name capture. When the welcome
  // page Step 1 sends a full_name, validate with the same rules the
  // booking flow uses (rejects placeholders, <2 chars, >80 chars),
  // then PATCH customers.full_name where phone = verified.phone.
  // Hard 400 on validation fail (user-visible toast); soft-fail on
  // any DB error after validation passed (cookie still re-issues so
  // the welcome flow proceeds — user can edit from the profile tab
  // in Step 13).
  if (body.full_name !== undefined && body.full_name !== null) {
    const v = validatePatientName(body.full_name);
    if (!v.ok) {
      return NextResponse.json({ error: v.error }, { status: 400 });
    }
    try {
      const { error: updateErr } = await supabaseAdmin
        .from("customers")
        .update({ full_name: v.name })
        .eq("phone", verified.phone);
      if (updateErr) {
        console.error(
          "[stay-signed-in-preference] full_name PATCH failed:",
          updateErr,
        );
      }
    } catch (cause) {
      console.error(
        "[stay-signed-in-preference] full_name PATCH threw:",
        cause,
      );
    }
  }

  let newToken: string;
  try {
    newToken = mintVerificationToken(verified.phone, staySignedIn);
  } catch (err) {
    console.error("[stay-signed-in-preference] mint failed:", err);
    return NextResponse.json({ error: "Server is misconfigured." }, { status: 500 });
  }

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set({
    name: VERIFY_COOKIE_NAME,
    value: newToken,
    // staySignedIn=true → persistent 1-year cookie + matching token exp
    // staySignedIn=false → session cookie (cleared on browser close) + 30-min token TTL
    // — both paths mirror the conditional set in /api/auth/verify-otp.
    ...pulseCookieOptions(staySignedIn ? PULSE_LONG_TTL_SECONDS : null),
  });
  return response;
}
