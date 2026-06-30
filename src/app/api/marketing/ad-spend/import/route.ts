import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { importAdSpend, type AdSpendInput } from "@/lib/marketing/adSpend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/marketing/ad-spend/import — secret-gated manual ad-spend import.
 *
 * Auth: `x-marketing-secret` header === MARKETING_INTAKE_SECRET (same secret as
 * the lead intake; fails closed if unset). Body: `{ rows: AdSpendInput[] }`
 * (spend_paise per source/campaign/date). Upserts idempotently on
 * (source, campaign, date) — re-importing a day overwrites, never duplicates.
 * This is the manual seam until the Meta/Google MCP connectors feed spend.
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

  let body: { rows?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!Array.isArray(body.rows)) {
    return NextResponse.json({ error: "Body must be { rows: AdSpendInput[] }." }, { status: 400 });
  }

  const result = await importAdSpend(body.rows as AdSpendInput[]);
  return NextResponse.json({ ok: true, ...result });
}
