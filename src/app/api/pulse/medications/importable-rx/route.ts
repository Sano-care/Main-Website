import { NextResponse, type NextRequest } from "next/server";

import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { getImportableRx } from "@/app/pulse/_lib/pulseData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/pulse/medications/importable-rx
//
// The most recent Sanocare prescription (status 'sent', within 7 days, not yet
// imported) that the signed-in customer could pull into their medications, or
// null. Drives the import banner on /pulse/medications. The actual import is
// POST …/medications/import-from-rx?rx_id=<id>. (T62 plan-of-record §3.)
//
// NOTE: static segment — wins over the sibling "[id]" dynamic route.

export async function GET(req: NextRequest) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;

  const rx = await getImportableRx(auth.customer.id);
  return NextResponse.json({ importable: rx });
}
