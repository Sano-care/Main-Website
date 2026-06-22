import { NextResponse } from "next/server";
import { checkCronSecret } from "@/app/api/cron/_auth";
import { runCarehubOfferSweep } from "@/lib/whatsapp/carehubOutbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cron/carehub-offer — trigger the CareHub proactive-offer sweep.
 *
 * Auth: `x-cron-secret` header === CRON_SECRET. Double-gated — even an
 * authorized call sends NOTHING unless WHATSAPP_CAREHUB_OFFER_ENABLED === "true"
 * (the sweep returns { ran:false } and audits carehub_skipped_flag_off).
 *
 * No standing scheduler is wired this slice (founder decision pending). This
 * endpoint is what a scheduler — or the founder's smoke test — calls.
 */
export async function POST(req: Request) {
  const denied = checkCronSecret(req);
  if (denied) return denied;

  const result = await runCarehubOfferSweep();
  return NextResponse.json({ ok: true, sweep: "carehub-offer", ...result });
}
