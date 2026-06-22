import { NextResponse } from "next/server";
import { checkCronSecret } from "@/app/api/cron/_auth";
import { runCarehubReminderSweep } from "@/lib/whatsapp/carehubReminder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cron/carehub-reminder — trigger the CareHub monthly home-visit
 * reminder sweep.
 *
 * Auth: `x-cron-secret` header === CRON_SECRET. Double-gated — even an
 * authorized call sends NOTHING unless WHATSAPP_CAREHUB_VISIT_REMINDER_ENABLED
 * === "true" (keep OFF until the UTILITY template is APPROVED at Meta). The
 * carehub_reminder_log UNIQUE makes repeat/concurrent calls safe (one reminder
 * per member per IST month).
 *
 * No standing scheduler is wired this slice; this is the trigger surface.
 */
export async function POST(req: Request) {
  const denied = checkCronSecret(req);
  if (denied) return denied;

  const result = await runCarehubReminderSweep();
  return NextResponse.json({ ok: true, sweep: "carehub-reminder", ...result });
}
