// Slice 5b — Feature A: CareHub proactive-offer sweep.
//
// Sends the APPROVED MARKETING template `aarogya_carehub_offer` to leads that
// expressed CareHub interest and have never been offered. ONE offer per lead,
// ever. Every send routes through dispatchTemplateMessage — the hardened path
// that RE-READS opt_out at send time and never touches the raw Graph API.
//
// Safety invariants:
//   - Flag-gated: nothing sends unless WHATSAPP_CAREHUB_OFFER_ENABLED === "true".
//     A flags-off run emits carehub_skipped_flag_off and sends NOTHING.
//   - opt_out is the hard gate, re-checked at send time inside the dispatcher
//     (not just here). A blocked lead is left pending (offer_sent_at stays null)
//     and audited — we never mark it offered, and nothing goes out.
//   - Idempotent: offer_sent_at is stamped only on a real send, guarded by
//     `.is("offer_sent_at", null)`, so a re-run never double-offers.
//   - Per-run ceiling (default 50) so a backlog can't fire an unbounded blast.
//   - Never throws: one bad lead is audited and skipped; the sweep continues.

import { supabaseAdmin } from "@/lib/supabase-server";
import {
  dispatchTemplateMessage,
  findOrCreateConversation,
} from "@/lib/whatsapp/db";
import { AuditEvent, writeAudit } from "@/lib/whatsapp/safety/audit";
import { isCarehubOfferEnabled } from "@/lib/whatsapp/carehubFlags";
import { log, maskPhone } from "@/lib/whatsapp/log";

const DEFAULT_OFFER_LIMIT = 50;

/** Grammar-safe first name for {{1}}; falls back to "there" ("Hi there"). */
export function firstNameOrFallback(fullName: string | null | undefined): string {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0];
}

type SupabaseLike = typeof supabaseAdmin;

export interface OfferSweepDeps {
  /** Service-role client (default real). Tests inject a fake. */
  supabase?: SupabaseLike;
  /** Hardened template dispatcher (default real). */
  dispatchTemplate?: typeof dispatchTemplateMessage;
  /** Phone → conversation resolver (default real). */
  resolveConversation?: typeof findOrCreateConversation;
  /** Flag override for tests; defaults to reading the env flag. */
  enabled?: boolean;
  /** Per-run ceiling. */
  limit?: number;
}

export interface OfferSweepResult {
  /** false when the flag is OFF (nothing was read or sent). */
  ran: boolean;
  considered: number;
  sent: number;
  blocked: number;
  failed: number;
}

export async function runCarehubOfferSweep(
  deps: OfferSweepDeps = {},
): Promise<OfferSweepResult> {
  const supabase = deps.supabase ?? supabaseAdmin;
  const dispatchTemplate = deps.dispatchTemplate ?? dispatchTemplateMessage;
  const resolveConversation = deps.resolveConversation ?? findOrCreateConversation;
  const enabled = deps.enabled ?? isCarehubOfferEnabled();
  const limit = deps.limit ?? DEFAULT_OFFER_LIMIT;

  if (!enabled) {
    await writeAudit({
      eventType: AuditEvent.CAREHUB_SKIPPED_FLAG_OFF,
      eventData: { sweep: "offer" },
    });
    return { ran: false, considered: 0, sent: 0, blocked: 0, failed: 0 };
  }

  // Pending, never-offered leads — matches idx_carehub_leads_offer_pending.
  const { data: leads, error } = await supabase
    .from("carehub_leads")
    .select("id, phone, customer_id")
    .is("contacted_at", null)
    .is("converted_subscription_id", null)
    .is("offer_sent_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    log.error("carehub offer sweep: lead read failed", error.message);
    await writeAudit({
      eventType: AuditEvent.CAREHUB_OFFER_SWEEP_RUN,
      eventData: { sweep: "offer", error: "lead_read_failed" },
    });
    return { ran: true, considered: 0, sent: 0, blocked: 0, failed: 0 };
  }

  const rows = (leads ?? []) as Array<{
    id: string;
    phone: string;
    customer_id: string | null;
  }>;

  let sent = 0;
  let blocked = 0;
  let failed = 0;

  for (const lead of rows) {
    try {
      const firstName = await resolveFirstName(supabase, lead.customer_id);
      const { conversation } = await resolveConversation(lead.phone);

      const result = await dispatchTemplate({
        conversationId: conversation.id,
        phone: lead.phone,
        templateName: "aarogya_carehub_offer",
        vars: { first_name: firstName },
      });

      if (result.sent) {
        // Stamp only the first time — the .is(null) guard makes a concurrent
        // double-run a no-op on the second writer.
        await supabase
          .from("carehub_leads")
          .update({
            offer_sent_at: new Date().toISOString(),
            offer_send_count: 1,
            offer_last_wamid: result.providerMessageId ?? null,
          })
          .eq("id", lead.id)
          .is("offer_sent_at", null);
        sent++;
        await writeAudit({
          conversationId: conversation.id,
          eventType: AuditEvent.CAREHUB_OFFER_SENT,
          eventData: { lead_id: lead.id, wamid: result.providerMessageId ?? null },
        });
      } else if (result.blocked) {
        // opt_out — leave pending (never mark offered), audit, send nothing.
        blocked++;
        await writeAudit({
          conversationId: conversation.id,
          eventType: AuditEvent.CAREHUB_OFFER_BLOCKED_OPTOUT,
          eventData: { lead_id: lead.id },
        });
      } else {
        failed++;
        await writeAudit({
          conversationId: conversation.id,
          eventType: AuditEvent.CAREHUB_OFFER_FAILED,
          eventData: { lead_id: lead.id, error: result.error ?? null },
        });
      }
    } catch (e) {
      failed++;
      log.error(
        "carehub offer sweep: lead failed",
        maskPhone(lead.phone),
        e instanceof Error ? e.message : String(e),
      );
      await writeAudit({
        eventType: AuditEvent.CAREHUB_OFFER_FAILED,
        eventData: { lead_id: lead.id, error: "exception" },
      });
      // never throw — continue to the next lead
    }
  }

  await writeAudit({
    eventType: AuditEvent.CAREHUB_OFFER_SWEEP_RUN,
    eventData: { sweep: "offer", considered: rows.length, sent, blocked, failed },
  });

  return { ran: true, considered: rows.length, sent, blocked, failed };
}

async function resolveFirstName(
  supabase: SupabaseLike,
  customerId: string | null,
): Promise<string> {
  if (!customerId) return "there";
  const { data } = await supabase
    .from("customers")
    .select("full_name")
    .eq("id", customerId)
    .maybeSingle();
  return firstNameOrFallback((data as { full_name: string | null } | null)?.full_name);
}
