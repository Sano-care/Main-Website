import { NextResponse } from "next/server";
import { checkCronSecret } from "@/app/api/cron/_auth";
import {
  reconcileDeps,
  runReconcileWatchdog,
} from "@/lib/whatsapp/aarogyaWatchdog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cron/aarogya-reconcile — the message-drop safety net.
 *
 * Auth: `x-cron-secret` === CRON_SECRET (fails closed). Driven by pg_cron every
 * 5 min. Requeues stuck turns, re-enqueues lost turns (unanswered >5min with no
 * queue row), and ops-alerts conversations that just crossed 2h unanswered.
 */
export async function POST(req: Request) {
  const denied = checkCronSecret(req);
  if (denied) return denied;
  const result = await runReconcileWatchdog(reconcileDeps());
  return NextResponse.json({ ok: true, watchdog: "aarogya-reconcile", ...result });
}
