// T65 Phase 1 — medic sign-out. Clears the medic verify cookie with
// Max-Age=0. Mirrors `/api/pulse/signout`.
//
// No auth check needed — clearing a cookie should always succeed; if no
// cookie exists, the response is a no-op, returning 204.

import { NextResponse } from "next/server";
import { MEDIC_COOKIE_NAME, medicCookieOptions } from "@/lib/otp/token";

export const runtime = "nodejs";

export async function POST() {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set({
    name: MEDIC_COOKIE_NAME,
    value: "",
    ...medicCookieOptions(0),
  });
  return response;
}
