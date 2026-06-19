// Slice 4a C4 — Ops router + relay draft store.
//
// Two responsibilities:
//
//   1. routeInbound(identity, ...) — single-shot decision: "is this turn
//      an ops_founder turn, or a normal patient turn?" The adapter calls
//      this AFTER the deterministic pre-checks (emergency, opt-out) and
//      uses it to pick which handler runs.
//
//   2. Relay draft lifecycle helpers — the ops mode "draft, confirm,
//      send" flow stores drafts as audit_log rows (no new table). The
//      lookup helpers find the most-recent-unexpired draft for an ops
//      conversation, mark drafts confirmed/cancelled/expired, and
//      surface the 15-minute window.
//
// The Claude composition of the actual draft body is NOT in this
// module — it's a thin executor in adapter.ts (C7) that runs Claude
// with a focused composer prompt and then calls createRelayDraft()
// here to persist the result.

import { supabaseAdmin } from "@/lib/supabase-server";
import { AuditEvent, writeAudit } from "@/lib/whatsapp/safety/audit";
import { FOUNDER_OPS_PHONE, FOUNDER_OPS_PHONE_DIGITS } from "@/lib/whatsapp/constants";
import { sendTemplateMessage } from "@/lib/whatsapp/cloud-api";
import { log } from "@/lib/whatsapp/log";
import type { Identity } from "@/lib/whatsapp/identity";

const LEAD_ALERT_TEMPLATE = "aarogya_lead_alert";

/** Relay draft TTL — ops has 15 minutes to confirm/refine. */
export const RELAY_DRAFT_TTL_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Routing decision
// ---------------------------------------------------------------------------

export type RoutingMode = "ops" | "patient";

export interface RoutingDecision {
  mode: RoutingMode;
  reason: string;
}

/**
 * Pick handler mode for an inbound turn.
 *
 * - ops_founder → ops mode (the relay/draft flow + ops-mode addendum)
 * - everything else → patient mode (current Aarogya behavior)
 *
 * NOTE: opt_out short-circuiting happens in adapter.ts BEFORE this is
 * called; opted-out patients never reach this router (their inbound is
 * acknowledged + dispatched skipped earlier). This function does NOT
 * re-check opt_out.
 */
export function routeInbound(identity: Identity): RoutingDecision {
  if (identity.role === "ops_founder") {
    return { mode: "ops", reason: "founder phone match" };
  }
  return { mode: "patient", reason: `role=${identity.role}` };
}

// ---------------------------------------------------------------------------
// Ops handoff — escalation template TO the founder
// ---------------------------------------------------------------------------

export interface EscalationPayload {
  conversationId: string;
  escalationId?: string | null;
  patientName: string;
  patientAge: string;
  serviceDisplay: string;
  location: string;
  context: string;
  patientMobile: string;
}

/**
 * Send the aarogya_lead_alert ops handoff template to FOUNDER_OPS_PHONE.
 * Single source of truth for "who is the ops alert target" — adapter.ts
 * keeps the MY_PERSONAL_WHATSAPP env var override for local testing but
 * the production target lives here.
 *
 * Best-effort: errors are logged, never thrown. The patient-facing
 * confirmation already went out before this is called.
 */
export async function escalateToOpsPhone(
  payload: EscalationPayload,
): Promise<{ providerMessageId?: string }> {
  const target =
    process.env.MY_PERSONAL_WHATSAPP?.replace(/[^\d]/g, "") ||
    FOUNDER_OPS_PHONE_DIGITS;

  try {
    const result = await sendTemplateMessage({
      to: target,
      templateName: LEAD_ALERT_TEMPLATE,
      bodyParams: [
        payload.patientName,
        payload.patientAge,
        payload.serviceDisplay,
        payload.location,
        payload.context,
        payload.patientMobile,
      ],
      quickReplyPayload: payload.escalationId ?? undefined,
    });
    await writeAudit({
      conversationId: payload.conversationId,
      eventType: AuditEvent.OPS_ALERT_SENT,
      eventData: {
        escalation_id: payload.escalationId,
        wamid: result.providerMessageId,
        target_phone: FOUNDER_OPS_PHONE,
      },
    });
    return { providerMessageId: result.providerMessageId };
  } catch (err) {
    log.error("escalateToOpsPhone template send failed", err);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Relay draft store (audit_log rows; no new table)
// ---------------------------------------------------------------------------

export interface RelayDraft {
  /** Audit row id — what ops references when confirming. */
  draftId: string;
  /** The ops conversation that produced the draft. */
  opsConversationId: string;
  /** Target patient (E.164 form). */
  targetPhone: string;
  /** The composed draft text (what would be sent to the patient). */
  draftBody: string;
  /** Patient's preferred language when the draft was composed. */
  language: string | null;
  /** When ops's confirmation window closes. */
  expiresAt: string;
  /** When the draft was composed. */
  createdAt: string;
}

export interface CreateRelayDraftInput {
  opsConversationId: string;
  targetPhone: string;
  instruction: string;
  draftBody: string;
  language: string | null;
  now?: Date; // injectable for tests
}

/**
 * Write the draft as an OPS_RELAY_DRAFTED audit row and return the row
 * id. The id IS the draft handle ops references implicitly via "YES" /
 * refinement on the conversation.
 */
export async function createRelayDraft(
  input: CreateRelayDraftInput,
): Promise<RelayDraft | null> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + RELAY_DRAFT_TTL_MS).toISOString();

  const { data, error } = await supabaseAdmin
    .from("audit_log")
    .insert({
      conversation_id: input.opsConversationId,
      event_type: AuditEvent.OPS_RELAY_DRAFTED,
      event_data: {
        target_phone: input.targetPhone,
        instruction: input.instruction,
        draft_body: input.draftBody,
        language: input.language,
        expires_at: expiresAt,
      },
    })
    .select("id, created_at")
    .single();

  if (error || !data) {
    log.error("createRelayDraft insert failed", error?.message);
    return null;
  }

  return {
    draftId: data.id as string,
    opsConversationId: input.opsConversationId,
    targetPhone: input.targetPhone,
    draftBody: input.draftBody,
    language: input.language,
    expiresAt,
    createdAt: data.created_at as string,
  };
}

/**
 * Find the most-recent UNEXPIRED draft for this ops conversation that
 * hasn't yet been confirmed or cancelled. Returns null when no eligible
 * draft exists (ops typed "YES" with no pending draft).
 *
 * The "unconfirmed/uncancelled" check is implicit: confirm/cancel write
 * NEW audit rows; we look at the latest OPS_RELAY_DRAFTED row and check
 * whether a CONFIRMED or CANCELLED row references the same draftId.
 */
export async function findLatestUnexpiredRelayDraft(
  opsConversationId: string,
  now: Date = new Date(),
): Promise<RelayDraft | null> {
  // Pull the most recent OPS_RELAY_DRAFTED for this conversation.
  const { data: drafts, error: draftsErr } = await supabaseAdmin
    .from("audit_log")
    .select("id, created_at, event_data")
    .eq("conversation_id", opsConversationId)
    .eq("event_type", AuditEvent.OPS_RELAY_DRAFTED)
    .order("created_at", { ascending: false })
    .limit(5);
  if (draftsErr || !drafts || drafts.length === 0) return null;

  // Pull confirmed/cancelled IDs so we can filter out already-resolved drafts.
  const { data: resolutions } = await supabaseAdmin
    .from("audit_log")
    .select("event_data")
    .eq("conversation_id", opsConversationId)
    .in("event_type", [
      AuditEvent.OPS_RELAY_CONFIRMED,
      AuditEvent.OPS_RELAY_CANCELLED,
      AuditEvent.OPS_RELAY_EXPIRED,
    ]);
  const resolvedIds = new Set<string>(
    (resolutions ?? [])
      .map((r) => (r.event_data as { draft_id?: string } | null)?.draft_id ?? "")
      .filter(Boolean),
  );

  for (const draft of drafts) {
    if (resolvedIds.has(draft.id as string)) continue;
    const eventData = draft.event_data as {
      target_phone?: string;
      draft_body?: string;
      language?: string | null;
      expires_at?: string;
    } | null;
    if (!eventData?.target_phone || !eventData.draft_body || !eventData.expires_at) {
      continue;
    }
    const expiresAt = new Date(eventData.expires_at);
    if (expiresAt.getTime() <= now.getTime()) {
      // Expired but not yet marked — surface to caller as null so the
      // expire-on-query helper can write the OPS_RELAY_EXPIRED row.
      continue;
    }
    return {
      draftId: draft.id as string,
      opsConversationId,
      targetPhone: eventData.target_phone,
      draftBody: eventData.draft_body,
      language: eventData.language ?? null,
      expiresAt: eventData.expires_at,
      createdAt: draft.created_at as string,
    };
  }
  return null;
}

export type RelayResolution = "confirmed" | "cancelled" | "expired";

/**
 * Write a companion audit row marking a draft resolved. Returns true on
 * success; best-effort like all audit writes.
 */
export async function markRelayDraftResolved(args: {
  opsConversationId: string;
  draftId: string;
  resolution: RelayResolution;
  /** When resolution=confirmed, the wamid of the patient-facing send. */
  sentWamid?: string;
}): Promise<boolean> {
  const eventType =
    args.resolution === "confirmed"
      ? AuditEvent.OPS_RELAY_CONFIRMED
      : args.resolution === "cancelled"
        ? AuditEvent.OPS_RELAY_CANCELLED
        : AuditEvent.OPS_RELAY_EXPIRED;
  return writeAudit({
    conversationId: args.opsConversationId,
    eventType,
    eventData: {
      draft_id: args.draftId,
      sent_wamid: args.sentWamid ?? null,
    },
  });
}
