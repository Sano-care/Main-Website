// GET /wa — the single paid-conversion endpoint (Google Ads, Meta CTWA, etc.).
// All logic lives in @/lib/wa/conversion so the /book-* campaign aliases can
// share it with the service hard-set. See that file for the full design.

import { NextRequest, NextResponse } from "next/server";
import { buildWaResponse } from "@/lib/wa/conversion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest): Promise<NextResponse> {
  return buildWaResponse(req); // service comes from ?service=
}
