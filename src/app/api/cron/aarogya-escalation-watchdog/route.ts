import { NextResponse } from "next/server";
import { checkCronSecret } from "@/app/api/cron/_auth";
import {
  escalationWatchdogDeps,
  runEscalationWatchdog,
} from "@/lib/whatsapp/aarogyaWatchdog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cron/aarogya-escalation-watchdog — Bug 3 re-alert.
 *
 * Auth: `x-cron-secret` === CRON_SECRET (fails closed). Driven by pg_cron daily.
 * Re-alerts ops for escalations stuck in escalation_status='requested' > 24h,
 * until the status flips to 'complete'. Alerts route to the ops number only.
 */
export async function POST(req: Request) {
  const denied = checkCronSecret(req);
  if (denied) return denied;
  const result = await runEscalationWatchdog(escalationWatchdogDeps());
  return NextResponse.json({
    ok: true,
    watchdog: "aarogya-escalation",
    ...result,
  });
}
