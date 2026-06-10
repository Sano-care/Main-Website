// POST /api/paid-click-log — beacon target for the /book-* landing pages.
//
// The pages fire navigator.sendBeacon() on load with the click context. This
// records it to paid_click_log (cookieless, DPDP-safe; IP hashed server-side,
// never stored raw). Returns 204 fast; the insert runs via after().

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { clientIp, hashIp, recordPaidClick } from "@/lib/wa/conversion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // sendBeacon may arrive as text/plain or empty — tolerate it.
  }

  const ipHash = hashIp(clientIp(req));
  const referrer = req.headers.get("referer");
  const userAgent = req.headers.get("user-agent");

  after(() =>
    recordPaidClick({
      service: str(body.service) ?? "other",
      utm_source: str(body.utm_source),
      utm_medium: str(body.utm_medium),
      utm_campaign: str(body.utm_campaign),
      utm_content: str(body.utm_content),
      utm_term: str(body.utm_term),
      gclid: str(body.gclid),
      referrer,
      user_agent: userAgent,
      ip_hash: ipHash,
    }),
  );

  return new NextResponse(null, { status: 204 });
}
