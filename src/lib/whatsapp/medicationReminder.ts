// Aarogya medication reminder sweep.
//
// A secret-gated cron (every 15 min) reminds patients to take each dose at its
// scheduled IST time via the UTILITY template `aarogya_medication_reminder`
// (3 body params in order: {{1}}=patient name, {{2}}=medicine, {{3}}=dose).
//
// Dose model: medications.scheduled_times is "HH:MM"[] in IST (confirmed from
// the Pulse writer + normaliseScheduledTimes). A dose at IST time T "fires" when
// now ∈ [T, T+15min). Quiet hours: only 07:00–22:00 IST inclusive.
//
// Dedupe — concurrency-safe CLAIM-BEFORE-SEND (mirrors carehubReminder):
//   INSERT medication_reminder_log (UNIQUE(medication_id, scheduled_for)) FIRST.
//   Win the insert → send; lose it (23505) → another run already sent this dose.
//   On send failure, DELETE the just-claimed row (the row only survives a real
//   send). The dose's 15-min window has passed by the next sweep, so there is no
//   re-send / nag either way — exactly one reminder per dose (D4).
//
// Safety: opt-out hard gate (the same conversations.opt_out signal CareHub
// uses — a patient who replied STOP gets no proactive send, even a utility
// reminder); flag-gated (WHATSAPP_MEDICATION_REMINDER_ENABLED, default OFF —
// ships inert until the template is APPROVED at Meta + a live smoke test); reads
// `medications` only (no meds-write); best-effort (one dose failing never aborts
// the sweep); never throws.
//
// IST conversion (R5): reuse the meds scheduler's OWN converter
// (_lib/ist.istWallTimeToUtc) rather than a parallel implementation, so a
// reminder fires at exactly the IST instant the patient's schedule encodes.
// IST is a fixed +05:30 (no DST); the date rollover is handled by the offset.

import { supabaseAdmin } from "@/lib/supabase-server";
import { sendTemplateMessage } from "@/lib/whatsapp/cloud-api";
import { findOrCreateConversation } from "@/lib/whatsapp/db";
import { AuditEvent, writeAudit } from "@/lib/whatsapp/safety/audit";
import { firstNameOrFallback } from "@/lib/whatsapp/carehubOutbound";
import { normaliseScheduledTimes } from "@/app/api/pulse/_lib/medications";
import { istTodayYMD, istWallTimeToUtc } from "@/app/api/pulse/_lib/ist";
import { log } from "@/lib/whatsapp/log";

export const MEDICATION_REMINDER_FLAG = "WHATSAPP_MEDICATION_REMINDER_ENABLED";
export const MEDICATION_REMINDER_TEMPLATE = "aarogya_medication_reminder";

/** Reminders fire only for doses scheduled within these IST hours (inclusive). */
export const QUIET_HOURS_START = "07:00";
export const QUIET_HOURS_END = "22:00";

// Cadence window — a dose at T fires when now ∈ [T, T+15min). Matches the
// every-15-minute Netlify schedule.
const WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_LIMIT = 1000;

type SupabaseLike = typeof supabaseAdmin;

interface MedicationRow {
  id: string;
  customer_id: string;
  name: string;
  dose: string;
  scheduled_times: unknown;
}

interface CustomerRow {
  phone: string | null;
  full_name: string | null;
}

export function isMedicationReminderEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[MEDICATION_REMINDER_FLAG] === "true";
}

/** Within quiet hours iff QUIET_HOURS_START ≤ hhmm ≤ QUIET_HOURS_END.
 *  Zero-padded "HH:MM" strings compare lexicographically by clock time. */
export function withinQuietHours(hhmm: string): boolean {
  return hhmm >= QUIET_HOURS_START && hhmm <= QUIET_HOURS_END;
}

export interface MedReminderDeps {
  supabase?: SupabaseLike;
  sendTemplate?: typeof sendTemplateMessage;
  /** Resolves the patient's conversation (carries the opt_out gate). */
  resolveConversation?: typeof findOrCreateConversation;
  writeAuditFn?: typeof writeAudit;
  /** Flag override for tests; defaults to the env flag. */
  enabled?: boolean;
  /** Injectable clock for the window + tests. */
  now?: Date;
}

export interface MedReminderResult {
  ran: boolean;
  consideredMeds: number;
  dueDoses: number;
  sent: number;
  skippedQuietHours: number;
  skippedNoPhone: number;
  skippedOptedOut: number;
  skippedAlreadySent: number;
  failed: number;
}

export async function runMedicationReminderSweep(
  deps: MedReminderDeps = {},
): Promise<MedReminderResult> {
  const supabase = deps.supabase ?? supabaseAdmin;
  const sendTemplate = deps.sendTemplate ?? sendTemplateMessage;
  const resolveConversation = deps.resolveConversation ?? findOrCreateConversation;
  const audit = deps.writeAuditFn ?? writeAudit;
  const enabled = deps.enabled ?? isMedicationReminderEnabled();
  const now = deps.now ?? new Date();

  const result: MedReminderResult = {
    ran: false,
    consideredMeds: 0,
    dueDoses: 0,
    sent: 0,
    skippedQuietHours: 0,
    skippedNoPhone: 0,
    skippedOptedOut: 0,
    skippedAlreadySent: 0,
    failed: 0,
  };

  if (!enabled) {
    await audit({
      eventType: AuditEvent.MEDICATION_REMINDER_SKIPPED,
      eventData: { reason: "flag_off" },
    });
    return result;
  }
  result.ran = true;

  const todayIst = istTodayYMD(now);

  // Active meds: started on/before today, not yet ended. end_date is a DATE; a
  // course is active through its end_date (inclusive).
  const { data: meds, error } = await supabase
    .from("medications")
    .select("id, customer_id, name, dose, scheduled_times")
    .lte("start_date", todayIst)
    .or(`end_date.is.null,end_date.gte.${todayIst}`)
    .limit(DEFAULT_LIMIT);

  if (error) {
    log.error("medication reminder sweep: medications read failed", error.message);
    return result;
  }

  const rows = (meds ?? []) as MedicationRow[];
  result.consideredMeds = rows.length;

  // Cache customer + opt-out lookups within the run (a med may have several due
  // doses, and one customer may have several meds).
  const customerCache = new Map<string, CustomerRow | null>();
  const optOutCache = new Map<string, boolean>(); // keyed by phone

  for (const med of rows) {
    const times = normaliseScheduledTimes(med.scheduled_times);
    for (const hhmm of times) {
      const instant = istWallTimeToUtc(todayIst, hhmm);
      if (!instant) continue;

      const ms = now.getTime() - instant.getTime();
      const due = ms >= 0 && ms < WINDOW_MS;
      if (!due) continue;
      result.dueDoses++;

      try {
        // Quiet hours — cheapest gate, no DB. Audited only for a due dose.
        if (!withinQuietHours(hhmm)) {
          result.skippedQuietHours++;
          await audit({
            eventType: AuditEvent.MEDICATION_REMINDER_SKIPPED,
            eventData: { reason: "quiet_hours", medication_id: med.id, dose_time: hhmm },
          });
          continue;
        }

        // Resolve the patient BEFORE claiming — a no-phone dose must not consume
        // its dedupe slot (so it can send once a phone exists).
        let customer = customerCache.get(med.customer_id);
        if (customer === undefined) {
          customer = await loadCustomer(supabase, med.customer_id);
          customerCache.set(med.customer_id, customer);
        }
        if (!customer?.phone) {
          result.skippedNoPhone++;
          await audit({
            eventType: AuditEvent.MEDICATION_REMINDER_SKIPPED,
            eventData: { reason: "no_phone", medication_id: med.id },
          });
          continue;
        }
        const phone = customer.phone;

        // OPT-OUT gate — the same signal CareHub uses (conversations.opt_out via
        // findOrCreateConversation). A patient who replied STOP gets no
        // proactive send, even a utility reminder (WABA quality + DPDP). Checked
        // BEFORE the claim so an opted-out dose never consumes a dedupe slot.
        let optedOut = optOutCache.get(phone);
        if (optedOut === undefined) {
          const { conversation } = await resolveConversation(phone);
          optedOut = conversation.opt_out;
          optOutCache.set(phone, optedOut);
        }
        if (optedOut) {
          result.skippedOptedOut++;
          await audit({
            eventType: AuditEvent.MEDICATION_REMINDER_SKIPPED,
            eventData: { reason: "opted_out", medication_id: med.id },
          });
          continue;
        }

        // CLAIM the dose slot. UNIQUE(medication_id, scheduled_for) → a second
        // run in the same window loses the insert (23505) and skips.
        const scheduledFor = instant.toISOString();
        const { data: claim, error: claimErr } = await supabase
          .from("medication_reminder_log")
          .insert({ medication_id: med.id, scheduled_for: scheduledFor })
          .select("id")
          .maybeSingle();

        if (claimErr) {
          if ((claimErr as { code?: string }).code === "23505") {
            result.skippedAlreadySent++;
            continue;
          }
          result.failed++;
          await audit({
            eventType: AuditEvent.MEDICATION_REMINDER_SKIPPED,
            eventData: { reason: "claim_failed", medication_id: med.id },
          });
          continue;
        }
        const claimId = (claim as { id: string } | null)?.id ?? null;

        try {
          const send = await sendTemplate({
            to: phone,
            templateName: MEDICATION_REMINDER_TEMPLATE,
            bodyParams: [firstNameOrFallback(customer.full_name), med.name, med.dose],
          });
          result.sent++;
          await audit({
            eventType: AuditEvent.MEDICATION_REMINDER_SENT,
            eventData: {
              medication_id: med.id,
              dose_time: hhmm,
              wamid: send.providerMessageId ?? null,
            },
          });
        } catch (sendErr) {
          // Release the claim so the ledger reflects only real sends. The dose's
          // window has passed by the next sweep, so this is not retried (no nag).
          if (claimId) {
            await supabase.from("medication_reminder_log").delete().eq("id", claimId);
          }
          result.failed++;
          log.error(
            "medication reminder: send failed",
            sendErr instanceof Error ? sendErr.message : String(sendErr),
          );
          await audit({
            eventType: AuditEvent.MEDICATION_REMINDER_SKIPPED,
            eventData: { reason: "send_failed", medication_id: med.id },
          });
        }
      } catch (e) {
        result.failed++;
        log.error(
          "medication reminder: dose failed",
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  }

  return result;
}

async function loadCustomer(
  supabase: SupabaseLike,
  customerId: string,
): Promise<CustomerRow | null> {
  const { data } = await supabase
    .from("customers")
    .select("phone, full_name")
    .eq("id", customerId)
    .maybeSingle();
  return (data as CustomerRow | null) ?? null;
}
