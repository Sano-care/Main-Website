import { NextRequest, NextResponse } from "next/server";

import {
  PULSE_LONG_TTL_SECONDS,
  VERIFY_COOKIE_NAME,
  mintVerificationToken,
  pulseCookieOptions,
  verifyToken,
} from "@/lib/otp/token";

export const runtime = "nodejs";

/**
 * POST /api/auth/stay-signed-in-preference
 *
 * Re-issues the Pulse OTP-verify cookie with a new `staySignedIn` flag.
 * Driven by the welcome-page Step 1 "Stay signed in on this phone"
 * checkbox (T90 Step 09): the user's deliberate consent toggle, applied
 * server-side so the cookie's Max-Age + the token's exp field both
 * reflect the user's actual choice (not the server-default true that
 * /api/auth/verify-otp seeds at OTP success).
 *
 * Body: { stay_signed_in: boolean }
 * Auth: requires a valid OTP verify cookie (just signed in via OTP).
 *
 * Returns:
 *   204 No Content — cookie re-set on response
 *   400 { error }  — invalid body
 *   401 { error }  — no valid verify cookie (sign in again)
 *
 * Idempotent: posting the same value as the current token is a harmless
 * no-op on the user's session (renews the cookie's expiry forward by
 * the same TTL).
 */
export async function POST(req: NextRequest) {
  let body: { stay_signed_in?: unknown };
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
