// Slice 5b — Feature B: CareHub monthly home-visit reminder sweep.
//
// Sends the UTILITY template `aarogya_carehub_monthly_visit_reminder` once per
// active member per IST calendar month. The benefit is a COMPLETE home visit
// (medic + doctor). Routes through dispatchTemplateMessage (opt_out re-checked
// at send; never raw Graph).
//
// Dedupe — concurrency-safe by CLAIM-BEFORE-SEND:
//   We INSERT the carehub_reminder_log row (UNIQUE(subscription_id,
//   period_yyyymm, reminder_type)) FIRST. If the insert hits the unique
//   constraint, another run already handled this member this month → skip. Only
//   the run that wins the insert proceeds to send. If that send then fails (or
//   opt_out blocks it), we DELETE our just-claimed row so the member can be
//   retried next sweep — the row only survives on a real send. This guarantees
//   "no double-send concurrently" (the exit criterion) while never permanently
//   suppressing a member because of a transient failure.
//
// Safety: flag-gated (WHATSAPP_CAREHUB_VISIT_REMINDER_ENABLED — also keep OFF
// until the template is APPROVED at Meta); opt_out hard gate; per-run ceiling;
// never throws.

import { supabaseAdmin } from "@/lib/supabase-server";
import {
  dispatchTemplateMessage,
  findOrCreateConversation,
} from "@/lib/whatsapp/db";
import { AuditEvent, writeAudit } from "@/lib/whatsapp/safety/audit";
import { isCarehubVisitReminderEnabled } from "@/lib/whatsapp/carehubFlags";
import { firstNameOrFallback } from "@/lib/whatsapp/carehubOutbound";
import { formatIST } from "@/lib/time/formatIST";
import { log } from "@/lib/whatsapp/log";

const DEFAULT_REMINDER_LIMIT = 500;
const REMINDER_TYPE = "monthly_visit";

type SupabaseLike = typeof supabaseAdmin;

/** IST calendar month as "YYYYMM" — derived from the existing formatIST("iso")
 *  ("2026-06-22T..+05:30") so the month boundary is IST, not UTC. */
export function istYearMonth(now: Date): string {
  const iso = formatIST(now, "iso"); // e.g. "2026-06-22T14:45:00+05:30"
  return iso.slice(0, 4) + iso.slice(5, 7);
}

export interface ReminderSweepDeps {
  supabase?: SupabaseLike;
  dispatchTemplate?: typeof dispatchTemplateMessage;
  resolveConversation?: typeof findOrCreateConversation;
  /** Flag override for tests; defaults to the env flag. */
  enabled?: boolean;
  /** Injectable clock for the period + tests. */
  now?: () => Date;
  /**
   * SOFT, best-effort suppression: return true if the member already booked a
   * CareHub home visit this month. Defaults to "never suppress" — the UNIQUE
   * ledger is the real dedupe, and a gentle reminder to someone who already
   * booked is harmless. Wire a real predicate once the founder confirms the
   * bookings classification for a CareHub home visit.
   */
  isVisitBookedThisMonth?: (args: {
    subscriptionId: string;
    customerId: string;
    periodYyyymm: string;
  }) => Promise<boolean>;
  limit?: number;
}

export interface ReminderSweepResult {
  ran: boolean;
  considered: number;
  sent: number;
  skippedAlreadySent: number;
  skippedVisitBooked: number;
  blocked: number;
  failed: number;
}

export async function runCarehubReminderSweep(
  deps: ReminderSweepDeps = {},
): Promise<ReminderSweepResult> {
  const supabase = deps.supabase ?? supabaseAdmin;
  const dispatchTemplate = deps.dispatchTemplate ?? dispatchTemplateMessage;
  const resolveConversation = deps.resolveConversation ?? findOrCreateConversation;
  const enabled = deps.enabled ?? isCarehubVisitReminderEnabled();
  const now = deps.now ?? (() => new Date());
  const isVisitBooked = deps.isVisitBookedThisMonth ?? (async () => false);
  const limit = deps.limit ?? DEFAULT_REMINDER_LIMIT;

  const result: ReminderSweepResult = {
    ran: false,
    considered: 0,
    sent: 0,
    skippedAlreadySent: 0,
    skippedVisitBooked: 0,
    blocked: 0,
    failed: 0,
  };

  if (!enabled) {
    await writeAudit({
      eventType: AuditEvent.CAREHUB_SKIPPED_FLAG_OFF,
      eventData: { sweep: "reminder" },
    });
    return result;
  }
  result.ran = true;

  const period = istYearMonth(now());

  const { data: subs, error } = await supabase
    .from("carehub_subscriptions")
    .select("id, customer_id")
    .eq("active", true)
    .limit(limit);

  if (error) {
    log.error("carehub reminder sweep: subscription read failed", error.message);
    await writeAudit({
      eventType: AuditEvent.CAREHUB_REMINDER_SWEEP_RUN,
      eventData: { sweep: "reminder", period, error: "subscription_read_failed" },
    });
    return result;
  }

  const rows = (subs ?? []) as Array<{ id: string; customer_id: string }>;
  result.considered = rows.length;

  for (const sub of rows) {
    try {
      // SOFT suppression — best-effort, never blocks the hard dedupe.
      if (await isVisitBooked({ subscriptionId: sub.id, customerId: sub.customer_id, periodYyyymm: period })) {
        result.skippedVisitBooked++;
        await writeAudit({
          eventType: AuditEvent.CAREHUB_REMINDER_SKIPPED_VISIT_BOOKED,
          eventData: { subscription_id: sub.id, period },
        });
        continue;
      }

      const customer = await loadCustomer(supabase, sub.customer_id);
      if (!customer?.phone) {
        result.failed++;
        await writeAudit({
          eventType: AuditEvent.CAREHUB_REMINDER_FAILED,
          eventData: { subscription_id: sub.id, period, error: "no_phone" },
        });
        continue;
      }

      // CLAIM the (subscription, period) slot first. ON CONFLICT DO NOTHING via
      // the UNIQUE constraint — if no row comes back, someone already handled
      // this member this month.
      const { data: claim, error: claimErr } = await supabase
        .from("carehub_reminder_log")
        .insert({ subscription_id: sub.id, period_yyyymm: period, reminder_type: REMINDER_TYPE })
        .select("id")
        .maybeSingle();

      if (claimErr) {
        // Unique violation (23505) = already claimed/sent → skip, not a failure.
        if ((claimErr as { code?: string }).code === "23505") {
          result.skippedAlreadySent++;
          await writeAudit({
            eventType: AuditEvent.CAREHUB_REMINDER_SKIPPED_ALREADY_SENT,
            eventData: { subscription_id: sub.id, period },
          });
          continue;
        }
        result.failed++;
        await writeAudit({
          eventType: AuditEvent.CAREHUB_REMINDER_FAILED,
          eventData: { subscription_id: sub.id, period, error: "claim_failed" },
        });
        continue;
      }
      const claimId = (claim as { id: string } | null)?.id ?? null;

      const { conversation } = await resolveConversation(customer.phone);
      const sendResult = await dispatchTemplate({
        conversationId: conversation.id,
        phone: customer.phone,
        templateName: "aarogya_carehub_monthly_visit_reminder",
        vars: { first_name: firstNameOrFallback(customer.full_name) },
      });

      if (sendResult.sent) {
        if (claimId) {
          await supabase
            .from("carehub_reminder_log")
            .update({ wamid: sendResult.providerMessageId ?? null })
            .eq("id", claimId);
        }
        result.sent++;
        await writeAudit({
          conversationId: conversation.id,
          eventType: AuditEvent.CAREHUB_REMINDER_SENT,
          eventData: { subscription_id: sub.id, period, wamid: sendResult.providerMessageId ?? null },
        });
      } else {
        // Block or failure — release the claim so the member can retry next run.
        if (claimId) {
          await supabase.from("carehub_reminder_log").delete().eq("id", claimId);
        }
        if (sendResult.blocked) {
          result.blocked++;
          await writeAudit({
            conversationId: conversation.id,
            eventType: AuditEvent.CAREHUB_REMINDER_BLOCKED_OPTOUT,
            eventData: { subscription_id: sub.id, period },
          });
        } else {
          result.failed++;
          await writeAudit({
            conversationId: conversation.id,
            eventType: AuditEvent.CAREHUB_REMINDER_FAILED,
            eventData: { subscription_id: sub.id, period, error: sendResult.error ?? null },
          });
        }
      }
    } catch (e) {
      result.failed++;
      log.error(
        "carehub reminder sweep: member failed",
        e instanceof Error ? e.message : String(e),
      );
      await writeAudit({
        eventType: AuditEvent.CAREHUB_REMINDER_FAILED,
        eventData: { subscription_id: sub.id, period, error: "exception" },
      });
    }
  }

  await writeAudit({
    eventType: AuditEvent.CAREHUB_REMINDER_SWEEP_RUN,
    eventData: {
      sweep: "reminder",
      period,
      considered: result.considered,
      sent: result.sent,
      skipped_already_sent: result.skippedAlreadySent,
      skipped_visit_booked: result.skippedVisitBooked,
      blocked: result.blocked,
      failed: result.failed,
    },
  });

  return result;
}

async function loadCustomer(
  supabase: SupabaseLike,
  customerId: string,
): Promise<{ phone: string | null; full_name: string | null } | null> {
  const { data } = await supabase
    .from("customers")
    .select("phone, full_name")
    .eq("id", customerId)
    .maybeSingle();
  return (data as { phone: string | null; full_name: string | null } | null) ?? null;
}
