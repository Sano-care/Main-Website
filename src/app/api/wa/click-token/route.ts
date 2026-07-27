import { NextResponse, type NextRequest } from "next/server";

import { mintWaClickToken } from "@/lib/wa/clickToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/wa/click-token
 *
 * Mint the short `SC-XXXXXX` handle for a Google Ads click so it can ride inside
 * a prefilled WhatsApp message. Called once per visitor by GclidCapture when a
 * gclid first lands; the token is then cached client-side and reused by every
 * WhatsApp CTA.
 *
 * Deliberately unauthenticated (it runs pre-identity, on a landing page) but
 * inert without a plausible gclid — it writes nothing else and returns only the
 * token it just created, so there is nothing to enumerate.
 *
 * Body: { gclid: string, wbraid?: string }
 *   200 { token }            — minted
 *   200 { token: null }      — no usable gclid / insert failed (caller falls
 *                              back to a plain WhatsApp link; never an error UX)
 */

const MAX_CLICK_ID_LEN = 512;

function sane(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CLICK_ID_LEN) return null;
  return trimmed;
}

export async function POST(req: NextRequest) {
  let body: { gclid?: unknown; wbraid?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ token: null }, { status: 200 });
  }

  const gclid = sane(body.gclid);
  if (!gclid) return NextResponse.json({ token: null }, { status: 200 });

  const token = await mintWaClickToken({ gclid, wbraid: sane(body.wbraid) });
  return NextResponse.json({ token });
}
