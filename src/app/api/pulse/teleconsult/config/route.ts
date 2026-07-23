import { NextResponse, type NextRequest } from "next/server";

import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { getServicePrice, getServiceHalfRoundedUp } from "@/constants/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/pulse/teleconsult/config
 *
 * PB4a — server-authoritative teleconsultation pricing for the Pulse app, so
 * the app never hardcodes a price. Drives the Home "Talk to a doctor" card copy
 * ("from ₹399") and the booking screen's advance amount. Bearer/cookie-authed
 * (the app always has a session before reaching Home) via requirePulseCustomer;
 * returns no user data.
 *
 *   200 { service, display_inr, advance_paise, currency }
 *   401 { error }
 */
export async function GET(req: NextRequest) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;

  const displayInr = getServicePrice("teleconsult"); // 399
  const advanceInr = getServiceHalfRoundedUp("teleconsult"); // 200 (50% ceil)

  return NextResponse.json({
    service: "teleconsultation",
    display_inr: displayInr,
    advance_paise: advanceInr * 100,
    currency: "INR",
  });
}
