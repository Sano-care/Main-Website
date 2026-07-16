import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import {
  PULSE_LONG_TTL_SECONDS,
  VERIFY_COOKIE_NAME,
  pulseCookieOptions,
  renewVerificationToken,
  verifyToken,
} from "@/lib/otp/token";
import {
  resolveCustomerById,
  resolveCustomerFromToken,
  type PulseCustomer,
} from "./getCurrentCustomer";
import {
  bearerFromAuthHeader,
  resolveMobileSessionCustomerId,
} from "@/lib/otp/mobileToken";

// Auth guard for the /api/pulse/* route handlers.
//
// Every Pulse data route is customer-scoped: it must resolve the signed-in
// `customers` row from the OTP verify cookie and 401 when that fails. This
// helper centralises that so each route reads:
//
//   const auth = await requirePulseCustomer(req);
//   if ("response" in auth) return auth.response;   // 401
//   const { customer } = auth;                       // safe from here
//
// It deliberately mirrors the cookie/verifyToken/customers-lookup chain used
// by /api/consent/record — same cookie name, same `verifyToken`, same
// `customers.phone` resolution — so there is exactly one identity contract
// across the patient surfaces.
//
// T90 — Sliding renewal:
// When the verified payload carries `staySignedIn === true`, this helper
// re-mints the token with a fresh `exp` and writes it back to the response
// via `cookies().set()` from `next/headers`. Net effect: an actively-used
// Pulse session never expires unless the user explicitly signs out.
//
// Old pre-T90 tokens (no `staySignedIn` field) read as `true` per the
// fallback in `verifyToken` — so existing active sessions keep working,
// and their next API hit upgrades their cookie to the new payload shape.

export type PulseAuthResult =
  | { customer: PulseCustomer }
  | { response: NextResponse };

/** 401 JSON body shape, shared so the client can branch uniformly. */
export function pulseUnauthorized(
  message = "Sign in to continue.",
): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

/**
 * Resolve the signed-in Pulse customer from the request's verify cookie, or
 * return a ready-to-send 401 response. Never throws.
 *
 * On success, when `staySignedIn === true` is encoded in the token, also
 * renew the cookie's expiry to PULSE_LONG_TTL_SECONDS forward of now.
 */
export async function requirePulseCustomer(
  req: NextRequest,
): Promise<PulseAuthResult> {
  // ── Native-app bearer path (additive; PB1) ──────────────────────────────
  // The Pulse Android app sends `Authorization: Bearer <opaque token>` instead
  // of the web cookie. Resolve it via mobile_session_tokens (hash → customer_id,
  // revoked rows excluded). Checked FIRST so the app never depends on cookies.
  // When no bearer header is present (every web request), this block is a no-op
  // and the cookie path below runs exactly as before.
  const bearer = bearerFromAuthHeader(req.headers.get("authorization"));
  if (bearer) {
    const customerId = await resolveMobileSessionCustomerId(bearer);
    if (!customerId) return { response: pulseUnauthorized() };
    const customer = await resolveCustomerById(customerId);
    if (!customer) return { response: pulseUnauthorized() };
    return { customer };
  }

  // ── Web cookie path (UNCHANGED) ─────────────────────────────────────────
  const token = req.cookies.get(VERIFY_COOKIE_NAME)?.value;
  // Verify the token signature + TTL first so we have access to the
  // staySignedIn flag for the renewal decision below. resolveCustomerFromToken
  // also calls verifyToken internally; the double-verify here is a few
  // microseconds and keeps the renewal logic readable.
  const verified = verifyToken(token);
  if (!verified) return { response: pulseUnauthorized() };

  const customer = await resolveCustomerFromToken(token);
  if (!customer) return { response: pulseUnauthorized() };

  // Sliding renewal — only when the user opted into Stay-signed-in. The
  // `?? true` fallback in verifyToken keeps pre-T90 active sessions alive
  // and migrates them onto the new shape via this very write.
  if (verified.staySignedIn) {
    try {
      const renewed = renewVerificationToken(verified);
      const cookieStore = await cookies();
      cookieStore.set({
        name: VERIFY_COOKIE_NAME,
        value: renewed,
        ...pulseCookieOptions(PULSE_LONG_TTL_SECONDS),
      });
    } catch (cause) {
      // Soft-fail: if the cookie write fails for any reason, the request
      // still proceeds with the existing (still-valid) cookie. The user
      // sees no disruption; renewal retries on the next API hit.
      console.error("[requirePulseCustomer] sliding renewal failed", cause);
    }
  }

  return { customer };
}
