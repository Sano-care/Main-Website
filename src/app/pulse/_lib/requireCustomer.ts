import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { VERIFY_COOKIE_NAME } from "@/lib/otp/token";
import {
  resolveCustomerFromToken,
  type PulseCustomer,
} from "./getCurrentCustomer";

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
 */
export async function requirePulseCustomer(
  req: NextRequest,
): Promise<PulseAuthResult> {
  const token = req.cookies.get(VERIFY_COOKIE_NAME)?.value;
  const customer = await resolveCustomerFromToken(token);
  if (!customer) {
    return { response: pulseUnauthorized() };
  }
  return { customer };
}
