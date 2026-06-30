import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { upsertMarketingLead } from "@/lib/marketing/leadIntake";
import { routeMarketingLead } from "@/lib/marketing/routing";
import {
  MARKETING_SOURCES,
  type MarketingLeadInput,
  type MarketingSource,
} from "@/lib/marketing/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/marketing/leads/intake — internal multi-source lead intake.
 *
 * Auth: `x-marketing-secret` header === MARKETING_INTAKE_SECRET (fails closed if
 * unset). Body is a MarketingLeadInput. Upserts (dedupe + merge attribution),
 * then routes (B2B → CRM, B2C hot → ops alert, opted-in → Aarogya-nurture).
 * Soft — intake itself never throws; this returns the routing decision.
 */
function checkSecret(req: Request): Response | null {
  const expected = process.env.MARKETING_INTAKE_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "MARKETING_INTAKE_SECRET not configured." }, { status: 500 });
  }
  const provided = req.headers.get("x-marketing-secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}

export async function POST(req: Request) {
  const denied = checkSecret(req);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!MARKETING_SOURCES.includes(body.source as MarketingSource)) {
    return NextResponse.json({ error: "Invalid or missing source." }, { status: 400 });
  }
  const contact = (body.contact ?? {}) as MarketingLeadInput["contact"];
  if (!contact.phone && !contact.whatsapp && !contact.email) {
    return NextResponse.json({ error: "A phone, whatsapp, or email is required." }, { status: 400 });
  }

  const input = body as unknown as MarketingLeadInput;
  const { lead, created, error } = await upsertMarketingLead(input);
  if (!lead) {
    return NextResponse.json({ error: error ?? "intake failed" }, { status: 500 });
  }

  const decision = await routeMarketingLead(lead, { urgencyHigh: input.urgency_high });
  return NextResponse.json({
    ok: true,
    lead_id: lead.id,
    created,
    state: decision.state,
    score: decision.score,
    track: decision.track,
    aarogya_nurture: decision.aarogyaNurture,
    ops_alerted: decision.opsAlerted,
  });
}
