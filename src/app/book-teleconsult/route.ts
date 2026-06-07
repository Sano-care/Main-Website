// GET /book-teleconsult — Google Ads alias for the Teleconsultation campaign.
// Shares the /wa conversion handler with service hard-set; UTM params flow
// through; returns 200 on-domain. See @/lib/wa/conversion.

import { NextRequest, NextResponse } from "next/server";
import { buildWaResponse } from "@/lib/wa/conversion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest): Promise<NextResponse> {
  return buildWaResponse(req, "teleconsult");
}
