import { NextResponse } from "next/server";

import { checkCronSecret } from "@/app/api/cron/_auth";
import { runConsultJoinSweep } from "@/lib/consult/joinLinkSweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cron/consult-join — PB4a. Deliver the /c/<token> teleconsult join
 * link (sanocare_consult_join) ~10 min before the slot, once per session.
 *
 * Auth: `x-cron-secret` header === CRON_SECRET (fails closed if unset).
 * Double-gated — even an authorized call sends NOTHING unless
 * WHATSAPP_CONSULT_ENABLED === "true". The claim-then-send idempotency on
 * consultation_sessions.join_link_sent_at makes repeat/overlapping calls safe
 * (one link per session). Scheduled every 5 min via the Netlify function.
 */
export async function POST(req: Request) {
  const denied = checkCronSecret(req);
  if (denied) return denied;

  const result = await runConsultJoinSweep();
  return NextResponse.json({ ok: true, sweep: "consult-join", ...result });
}
