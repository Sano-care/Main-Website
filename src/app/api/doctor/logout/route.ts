import { NextResponse } from "next/server";
import { DOCTOR_SESSION_COOKIE_NAME } from "@/lib/otp/token";

export const runtime = "nodejs";

/**
 * POST /api/doctor/logout
 *
 * Clears the doctor session cookie. Always succeeds — there is nothing
 * sensitive about logging out, and the operation should work even if
 * the cookie is missing or malformed. Returns 200 unconditionally so the
 * client can navigate to /doctor/login afterwards without branching.
 */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: DOCTOR_SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
