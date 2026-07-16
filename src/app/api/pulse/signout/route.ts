import { NextResponse, type NextRequest } from "next/server";

import { VERIFY_COOKIE_NAME } from "@/lib/otp/token";
import {
  bearerFromAuthHeader,
  revokeMobileSessionToken,
} from "@/lib/otp/mobileToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/pulse/signout
//
// Clears the shared OTP verify cookie (sanocare_otp_verify) so the patient is
// signed out of Pulse. The cookie is cleared with the SAME name/path/attributes
// it was minted with by /api/auth/verify-otp (httpOnly, sameSite lax, secure in
// prod, path "/") plus maxAge 0 so the browser drops it immediately.
//
// 204 No Content — the client redirects to /pulse/login on success. This only
// clears the patient verify cookie; it deliberately leaves any doctor session
// cookie (sanocare_doctor_session) untouched.

export async function POST(req: NextRequest) {
  // PB1 — native app: when signing out with a bearer token, revoke it
  // server-side (sets revoked_at) so its next /api/pulse/* call 401s. Web
  // requests carry no bearer, so this is a no-op and the cookie clear below is
  // unchanged.
  const bearer = bearerFromAuthHeader(req.headers.get("authorization"));
  if (bearer) {
    await revokeMobileSessionToken(bearer);
  }

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set({
    name: VERIFY_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
