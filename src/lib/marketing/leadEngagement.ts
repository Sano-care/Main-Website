// Aarogya Lead Engine P1 — engagement layer. Inverts the old ops-first-touch:
// Aarogya ENGAGES a fresh lead (throttled first-contact template), the lead
// REPLIES (→ opted_in), Aarogya QUALIFIES, and ONLY a qualified lead is
// forwarded to ops. Everything is env-flagged OFF (AAROGYA_LEAD_ENGAGE_ENABLED)
// so it ships INERT — no sends, no behaviour change until the founder flips it
// after Meta approves the templates.
//
// WABA stop-loss (non-negotiable): a single control row can halt all sends;
// the sweep refuses to send while halted. Protecting the WABA outranks any lead.

import { supabaseAdmin } from "@/lib/supabase-server";
import { sendTemplateMessage } from "@/lib/whatsapp/cloud-api";
import { sendOpsAlert } from "@/lib/whatsapp/opsAlert";
import { AuditEvent, writeAudit } from "@/lib/whatsapp/safety/audit";
import { istDateISO } from "@/lib/time/formatIST";
import { log } from "@/lib/whatsapp/log";
import { marketingLeadToOpsAlert } from "./opsContext";
import { normalizePhone, type MarketingLead, type ServiceIntent } from "./types";

type SupabaseLike = typeof supabaseAdmin;

export const ENGAGE_FLAG = "AAROGYA_LEAD_ENGAGE_ENABLED";
/** Sources that arrive as hand-raisers/attested (not opted-in) → engaged with a
 *  first-contact template carrying opt-out. MUST match the DB guard
 *  (marketing_leads_engagement_source_check). */
export const CONTACT_CONSENTED_SOURCES = ["justdial", "google_lead_form"] as const;
export const T1_DAILY_CAP = 10;
export const ELIGIBLE_DAYS = 7;
export const T2_DELAY_HOURS = 48;

const DAY_MS = 86_400_000;

function t1Template(env: NodeJS.ProcessEnv): string {
  return env.AAROGYA_LEAD_T1_TEMPLATE ?? "lead_first_contact";
}
function t2Template(env: NodeJS.ProcessEnv): string {
  return env.AAROGYA_LEAD_T2_TEMPLATE ?? "lead_follow_up";
}

export function isEngageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ENGAGE_FLAG] === "true";
}

function firstName(name: string | null | undefined): string {
  const t = (name ?? "").trim().split(/\s+/)[0];
  return t || "there";
}

/** Source-aware opening-line variable for the T1 template. */
function sourceOpener(source: string): string {
  switch (source) {
    case "justdial":
      return "You enquired about home healthcare on JustDial";
    case "google_lead_form":
      return "You enquired about home healthcare through our ad";
    default:
      return "You enquired about home healthcare";
  }
}

export interface EngageDeps {
  supabase?: SupabaseLike;
  sendTemplate?: typeof sendTemplateMessage;
  sendOpsAlertFn?: typeof sendOpsAlert;
  writeAuditFn?: typeof writeAudit;
  enabled?: boolean;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}

// ── WABA stop-loss ─────────────────────────────────────────────────────────

export async function isEngagementHalted(supabase: SupabaseLike): Promise<boolean> {
  const { data } = await supabase
    .from("marketing_engagement_control")
    .select("halted")
    .eq("id", 1)
    .maybeSingle();
  return Boolean((data as { halted?: boolean } | null)?.halted);
}

/** Trip the stop-loss: halt all T1/T2 sends + loudly alert the founder. Called
 *  when WABA quality drops / spam spikes / Meta pauses a template. */
export async function haltLeadEngagement(reason: string, deps: EngageDeps = {}): Promise<void> {
  const supabase = deps.supabase ?? supabaseAdmin;
  const sendOpsAlertFn = deps.sendOpsAlertFn ?? sendOpsAlert;
  const audit = deps.writeAuditFn ?? writeAudit;
  const nowIso = (deps.now ?? new Date()).toISOString();
  try {
    await supabase
      .from("marketing_engagement_control")
      .update({ halted: true, halted_reason: reason, halted_at: nowIso })
      .eq("id", 1);
  } catch (e) {
    log.error("haltLeadEngagement update failed", e instanceof Error ? e.message : String(e));
  }
  await audit({ eventType: AuditEvent.LEAD_ENGAGE_HALTED, eventData: { reason } });
  try {
    await sendOpsAlertFn({
      conversationId: null,
      escalationId: null,
      patientName: "WABA STOP-LOSS",
      patientAge: "—",
      serviceDisplay: "Lead engagement halted",
      location: "—",
      context: `Aarogya lead engagement HALTED — ${reason}. All T1/T2 sends stopped.`,
      patientMobile: "—",
    });
  } catch (e) {
    log.error("haltLeadEngagement founder alert failed", e instanceof Error ? e.message : String(e));
  }
}

// ── Engagement sweep (throttled, oldest-first) ─────────────────────────────

const ENGAGE_COLS =
  "id, source, campaign, consent_status, state, service_intent, contact, normalized_phone, notes, engagement_state, t1_sent_at, created_at";

export interface SweepResult {
  ran: boolean;
  reason?: string;
  t1Sent: number;
  t2Sent: number;
  failed: number;
}

export async function runLeadEngagementSweep(deps: EngageDeps = {}): Promise<SweepResult> {
  const supabase = deps.supabase ?? supabaseAdmin;
  const sendTemplate = deps.sendTemplate ?? sendTemplateMessage;
  const audit = deps.writeAuditFn ?? writeAudit;
  const env = deps.env ?? process.env;
  const enabled = deps.enabled ?? isEngageEnabled(env);
  const now = deps.now ?? new Date();
  const result: SweepResult = { ran: false, t1Sent: 0, t2Sent: 0, failed: 0 };

  if (!enabled) {
    await audit({ eventType: AuditEvent.LEAD_ENGAGE_SKIPPED, eventData: { reason: "flag_off" } });
    return { ...result, reason: "flag_off" };
  }
  if (await isEngagementHalted(supabase)) {
    await audit({ eventType: AuditEvent.LEAD_ENGAGE_SKIPPED, eventData: { reason: "halted" } });
    return { ...result, reason: "halted" };
  }
  result.ran = true;

  // ── T1: throttled (max T1_DAILY_CAP/day, IST), oldest-first, <7d, pending. ──
  const todayIstStart = new Date(`${istDateISO(now)}T00:00:00+05:30`).toISOString();
  const { count: sentToday } = await supabase
    .from("marketing_leads")
    .select("id", { count: "exact", head: true })
    .gte("t1_sent_at", todayIstStart);
  const remaining = Math.max(0, T1_DAILY_CAP - (sentToday ?? 0));

  if (remaining > 0) {
    const since = new Date(now.getTime() - ELIGIBLE_DAYS * DAY_MS).toISOString();
    const { data: eligible } = await supabase
      .from("marketing_leads")
      .select(ENGAGE_COLS)
      .in("source", [...CONTACT_CONSENTED_SOURCES])
      .eq("consent_status", "pending")
      .eq("engagement_state", "none")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(remaining);

    for (const lead of (eligible ?? []) as unknown as MarketingLead[]) {
      const phone = lead.contact?.phone ?? lead.contact?.whatsapp ?? "";
      if (!phone) continue;
      try {
        const send = await sendTemplate({
          to: phone,
          // {{1}} greeting (lead name isn't stored on the row → generic),
          // {{2}} source-aware opener. Marketing session finalizes the approved
          // template's var order; align here at go-live.
          templateName: t1Template(env),
          bodyParams: [firstName(null), sourceOpener(lead.source)],
        });
        await supabase
          .from("marketing_leads")
          .update({ engagement_state: "t1_sent", t1_sent_at: now.toISOString() })
          .eq("id", lead.id);
        result.t1Sent++;
        await audit({
          eventType: AuditEvent.LEAD_ENGAGE_SENT,
          eventData: { template: "t1", lead_id: lead.id, source: lead.source, wamid: send.providerMessageId ?? null },
        });
      } catch (e) {
        result.failed++;
        log.error("lead engage T1 send failed", lead.id, e instanceof Error ? e.message : String(e));
      }
    }
  }

  // ── T2: single 48h follow-up when T1 got no reply. ──
  const t2Before = new Date(now.getTime() - T2_DELAY_HOURS * 3_600_000).toISOString();
  const { data: t2Eligible } = await supabase
    .from("marketing_leads")
    .select(ENGAGE_COLS)
    .eq("engagement_state", "t1_sent")
    .is("last_inbound_at", null)
    .lte("t1_sent_at", t2Before)
    .neq("consent_status", "opted_out")
    .limit(T1_DAILY_CAP);

  for (const lead of (t2Eligible ?? []) as unknown as MarketingLead[]) {
    const phone = lead.contact?.phone ?? lead.contact?.whatsapp ?? "";
    if (!phone) continue;
    try {
      await sendTemplate({
        to: phone,
        templateName: t2Template(env),
        bodyParams: ["there", sourceOpener(lead.source)],
      });
      await supabase
        .from("marketing_leads")
        .update({ engagement_state: "t2_sent", t2_sent_at: now.toISOString() })
        .eq("id", lead.id);
      result.t2Sent++;
      await audit({
        eventType: AuditEvent.LEAD_ENGAGE_SENT,
        eventData: { template: "t2", lead_id: lead.id, source: lead.source },
      });
    } catch (e) {
      result.failed++;
      log.error("lead engage T2 send failed", lead.id, e instanceof Error ? e.message : String(e));
    }
  }

  await audit({
    eventType: AuditEvent.LEAD_ENGAGE_SWEEP_RUN,
    eventData: { t1_sent: result.t1Sent, t2_sent: result.t2Sent, failed: result.failed },
  });
  return result;
}

// ── Inbound: reply → opted_in (+ v0 qualify), STOP → opted_out ─────────────

export interface ReplyResult {
  updated: boolean;
  qualified: boolean;
}

/** An engaged lead replied → opt them in, stamp the inbound, and (v0 provisional
 *  bar) if they already have a service_intent, qualify + forward to ops. No-op
 *  for a phone with no engaged marketing lead (so it's safe on every inbound). */
export async function handleLeadReplied(
  phone: string,
  deps: EngageDeps = {},
): Promise<ReplyResult> {
  const supabase = deps.supabase ?? supabaseAdmin;
  const audit = deps.writeAuditFn ?? writeAudit;
  const now = deps.now ?? new Date();
  try {
    const norm = normalizePhone(phone);
    if (!norm) return { updated: false, qualified: false };

    const { data } = await supabase
      .from("marketing_leads")
      .select(ENGAGE_COLS)
      .eq("normalized_phone", norm)
      .in("engagement_state", ["t1_sent", "t2_sent"])
      .maybeSingle();
    const lead = data as unknown as MarketingLead | null;
    if (!lead) return { updated: false, qualified: false };

    await supabase
      .from("marketing_leads")
      .update({
        consent_status: "opted_in",
        engagement_state: "replied",
        last_inbound_at: now.toISOString(),
      })
      .eq("id", lead.id);
    await audit({
      eventType: AuditEvent.LEAD_REPLIED_OPTED_IN,
      eventData: { lead_id: lead.id, source: lead.source },
    });

    // v0 provisional qualify: a replied lead that already carries a real need
    // (service_intent, mapped at ingest) meets the minimal bar. Serviceability
    // is a v-next check; the founder revisits qualification.
    if (lead.service_intent) {
      await qualifyLead(lead.id, {}, deps);
      return { updated: true, qualified: true };
    }
    return { updated: true, qualified: false };
  } catch (e) {
    log.error("handleLeadReplied failed", e instanceof Error ? e.message : String(e));
    return { updated: false, qualified: false };
  }
}

/** STOP / opt-out → flag the marketing lead opted_out (any source; the DB guard
 *  permits opted_out universally). conversations.opt_out is handled by the
 *  existing setOptOut path. Soft-fail; safe on every opt-out. */
export async function markLeadOptedOut(phone: string, deps: EngageDeps = {}): Promise<{ optedOut: boolean }> {
  const supabase = deps.supabase ?? supabaseAdmin;
  const audit = deps.writeAuditFn ?? writeAudit;
  try {
    const norm = normalizePhone(phone);
    if (!norm) return { optedOut: false };
    const { data } = await supabase
      .from("marketing_leads")
      .update({ consent_status: "opted_out", engagement_state: "opted_out" })
      .eq("normalized_phone", norm)
      .neq("consent_status", "opted_out")
      .select("id")
      .maybeSingle();
    const hit = Boolean((data as { id?: string } | null)?.id);
    if (hit) {
      await audit({ eventType: AuditEvent.LEAD_OPTED_OUT, eventData: { source: "inbound" } });
    }
    return { optedOut: hit };
  } catch (e) {
    log.error("markLeadOptedOut failed", e instanceof Error ? e.message : String(e));
    return { optedOut: false };
  }
}

// ── Qualify → forward to ops (the ONLY ops ping) ───────────────────────────

export async function qualifyLead(
  leadId: string,
  patch: { service_intent?: ServiceIntent; notes?: string },
  deps: EngageDeps = {},
): Promise<{ qualified: boolean }> {
  const supabase = deps.supabase ?? supabaseAdmin;
  try {
    const update: Record<string, unknown> = { state: "qualified" };
    if (patch.service_intent) update.service_intent = patch.service_intent;
    if (patch.notes) update.notes = patch.notes;
    const { data } = await supabase
      .from("marketing_leads")
      .update(update)
      .eq("id", leadId)
      .select(ENGAGE_COLS)
      .maybeSingle();
    const lead = data as unknown as MarketingLead | null;
    if (!lead) return { qualified: false };
    await forwardQualifiedLeadToOps(lead, deps);
    return { qualified: true };
  } catch (e) {
    log.error("qualifyLead failed", e instanceof Error ? e.message : String(e));
    return { qualified: false };
  }
}

/** The ONLY point ops is notified — reuses opsAlert.ts + the marketing lead
 *  {{5}} context (name · service · area · source). Best-effort. */
export async function forwardQualifiedLeadToOps(lead: MarketingLead, deps: EngageDeps = {}): Promise<boolean> {
  const sendOpsAlertFn = deps.sendOpsAlertFn ?? sendOpsAlert;
  const audit = deps.writeAuditFn ?? writeAudit;
  try {
    const res = await sendOpsAlertFn(marketingLeadToOpsAlert(lead));
    await audit({
      eventType: AuditEvent.LEAD_QUALIFIED_FORWARDED,
      eventData: { lead_id: lead.id, source: lead.source, sent: res.sent },
    });
    return res.sent;
  } catch (e) {
    log.error("forwardQualifiedLeadToOps failed", e instanceof Error ? e.message : String(e));
    return false;
  }
}
