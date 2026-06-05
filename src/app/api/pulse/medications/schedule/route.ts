import { NextResponse, type NextRequest } from "next/server";

import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { getTodaySchedule } from "@/app/pulse/_lib/pulseData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/pulse/medications/schedule
//
// Today's doses (IST) across the signed-in customer's active medications,
// each joined to its medication name + dose. Shares getTodaySchedule with the
// SSR home tile so both surfaces agree on what "today" contains.
//
// NOTE: static segment — wins over the sibling "[id]" dynamic route.

export async function GET(req: NextRequest) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;

  const doses = await getTodaySchedule(auth.customer.id);
  return NextResponse.json({ doses });
}
