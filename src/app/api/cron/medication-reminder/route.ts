import { NextResponse } from "next/server";
import { checkCronSecret } from "@/app/api/cron/_auth";
import { runMedicationReminderSweep } from "@/lib/whatsapp/medicationReminder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cron/medication-reminder — sweep active medications and remind
 * patients of any dose due in the current 15-min IST window.
 *
 * Auth: `x-cron-secret` header === CRON_SECRET (fails closed if unset).
 * Double-gated — even an authorized call sends NOTHING unless
 * WHATSAPP_MEDICATION_REMINDER_ENABLED === "true" (keep OFF until the UTILITY
 * template `aarogya_medication_reminder` is APPROVED at Meta + smoke-tested).
 * The medication_reminder_log UNIQUE makes repeat/concurrent calls safe (one
 * reminder per dose). Scheduled every 15 min via the Netlify function.
 */
export async function POST(req: Request) {
  const denied = checkCronSecret(req);
  if (denied) return denied;

  const result = await runMedicationReminderSweep();
  return NextResponse.json({ ok: true, sweep: "medication-reminder", ...result });
}
