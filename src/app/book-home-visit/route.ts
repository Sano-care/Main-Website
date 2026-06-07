// GET /book-home-visit — Google Ads alias for the Home Visit + Doctor Consult
// campaign. Shares the /wa conversion handler with service hard-set, so the
// service is guaranteed (a rewrite's static query is dropped on Netlify) while
// the incoming UTM params still flow through. Returns 200 (stays on-domain).

import { NextRequest, NextResponse } from "next/server";
import { buildWaResponse } from "@/lib/wa/conversion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest): Promise<NextResponse> {
  return buildWaResponse(req, "home_visit");
}
