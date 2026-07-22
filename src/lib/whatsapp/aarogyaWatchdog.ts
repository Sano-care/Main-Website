// Aarogya watchdogs — the safety nets that catch a dropped turn even if the
// queue itself fails, and re-alert on escalations that ops never actioned.
//
//  - runReconcileWatchdog (every 5 min): (1) hand rows stuck 'processing'
//    (worker died mid-turn) back to the drain; (2) re-enqueue any conversation
//    whose user message is unanswered >5 min with NO active queue row (the
//    enqueue was lost); (3) ops-alert conversations that just crossed 2h
//    unanswered (fires once per crossing, not every run).
//  - runEscalationWatchdog (daily): re-alert escalations stuck
//    escalation_status='requested' > 24h until they flip to 'complete'.
//
// All alerts go through opsAlert.ts → FOUNDER_OPS_PHONE_DIGITS (919760059900),
// NEVER the WABA number. Dependency-injected so the crons are unit-testable
// without Supabase or the WhatsApp BSP.

import { supabaseAdmin } from "@/lib/supabase-server";
import { sendOpsAlert } from "@/lib/whatsapp/opsAlert";
import { enqueueTurn, requeueStuckTurns } from "@/lib/whatsapp/turnQueue";
import { log } from "@/lib/whatsapp/log";
import type { NormalizedInbound } from "@/types/whatsapp";

// ── reconcile ────────────────────────────────────────────────────────────────

export interface ReconcileCandidate {
  conversation_id: string;
  phone: string;
  message_id: string | null;
  content: string | null;
  content_type: string | null;
  raw_payload: unknown;
  provider_message_id: string | null;
}

export interface StaleConversation {
  conversation_id: string;
  phone: string;
  last_user_msg_at: string;
}

export interface ReconcileDeps {
  requeueStuck: (olderThanSeconds?: number) => Promise<number>;
  getCandidates: () => Promise<ReconcileCandidate[]>;
  getStale: () => Promise<StaleConversation[]>;
  enqueue: (args: {
    conversationId: string;
    messageId: string | null;
    inbound: NormalizedInbound;
    debounceMs?: number;
  }) => Promise<string | null>;
  sendOpsAlertFn?: typeof sendOpsAlert;
}

/** Rebuild a minimal NormalizedInbound from a persisted inbound message row. */
function inboundFromCandidate(c: ReconcileCandidate): NormalizedInbound {
  const t = (c.content_type ?? "text") as NormalizedInbound["type"];
  return {
    providerMessageId: c.provider_message_id ?? "",
    phone: c.phone,
    type: t,
    text: c.content ?? "",
    contactName: null,
    phoneNumberId: null,
    timestamp: "",
    buttonPayload: null,
    buttonText: null,
    contextId: null,
    raw: (c.raw_payload ?? {}) as NormalizedInbound["raw"],
  };
}

export interface ReconcileResult {
  requeuedStuck: number;
  reEnqueued: number;
  opsAlerted: number;
}

export async function runReconcileWatchdog(
  deps: ReconcileDeps,
): Promise<ReconcileResult> {
  const sendOpsAlertFn = deps.sendOpsAlertFn ?? sendOpsAlert;

  // (1) hand stuck 'processing' rows back to the drain.
  const requeuedStuck = await deps.requeueStuck(180);

  // (2) re-enqueue lost turns (unanswered >5min, no active queue row).
  const candidates = await deps.getCandidates();
  let reEnqueued = 0;
  for (const c of candidates) {
    const id = await deps.enqueue({
      conversationId: c.conversation_id,
      messageId: c.message_id,
      inbound: inboundFromCandidate(c),
      debounceMs: 0, // already overdue — process ASAP
    });
    if (id) reEnqueued++;
  }

  // (3) ops-alert conversations that just crossed 2h unanswered.
  const stale = await deps.getStale();
  let opsAlerted = 0;
  for (const s of stale) {
    const res = await sendOpsAlertFn({
      conversationId: s.conversation_id,
      escalationId: null,
      patientName: "⚠ UNANSWERED >2h",
      patientAge: "—",
      serviceDisplay: "Aarogya reply never sent",
      location: "Check the WhatsApp thread",
      context: `A patient message has gone unanswered for over 2 hours (conversation ${s.conversation_id}). The bot may have dropped the turn — reply manually.`,
      patientMobile: s.phone,
    });
    if (res.sent) opsAlerted++;
  }

  log.info(
    "aarogya reconcile",
    `stuck=${requeuedStuck} reEnqueued=${reEnqueued} opsAlerted=${opsAlerted}`,
  );
  return { requeuedStuck, reEnqueued, opsAlerted };
}

// ── escalation watchdog ──────────────────────────────────────────────────────

export interface StuckEscalation {
  conversation_id: string;
  phone: string;
  updated_at: string;
}

export interface EscalationWatchdogDeps {
  getStuck: () => Promise<StuckEscalation[]>;
  sendOpsAlertFn?: typeof sendOpsAlert;
}

export interface EscalationWatchdogResult {
  found: number;
  alerted: number;
}

export async function runEscalationWatchdog(
  deps: EscalationWatchdogDeps,
): Promise<EscalationWatchdogResult> {
  const sendOpsAlertFn = deps.sendOpsAlertFn ?? sendOpsAlert;
  const stuck = await deps.getStuck();
  let alerted = 0;
  for (const e of stuck) {
    const res = await sendOpsAlertFn({
      conversationId: e.conversation_id,
      escalationId: null,
      patientName: "⚠ ESCALATION UNACTIONED >24h",
      patientAge: "—",
      serviceDisplay: "Escalation still 'requested'",
      location: "Action in ops, then Mark as Attended",
      context: `An escalation has sat in 'requested' for over 24h (conversation ${e.conversation_id}, since ${e.updated_at}). Action it and mark it complete.`,
      patientMobile: e.phone,
    });
    if (res.sent) alerted++;
  }
  log.info("aarogya escalation watchdog", `found=${stuck.length} alerted=${alerted}`);
  return { found: stuck.length, alerted };
}

// ── default (production) dependency wiring ───────────────────────────────────

export const reconcileDeps = (): ReconcileDeps => ({
  requeueStuck: requeueStuckTurns,
  getCandidates: async () => {
    const { data, error } = await supabaseAdmin.rpc(
      "aarogya_reconcile_candidates",
      { p_min_minutes: 5, p_limit: 50 },
    );
    if (error) {
      log.error("aarogya_reconcile_candidates failed", error.message);
      return [];
    }
    return (data as ReconcileCandidate[]) ?? [];
  },
  getStale: async () => {
    const { data, error } = await supabaseAdmin.rpc("aarogya_stale_unanswered", {
      p_hours: 2,
      p_window_minutes: 6,
      p_limit: 25,
    });
    if (error) {
      log.error("aarogya_stale_unanswered failed", error.message);
      return [];
    }
    return (data as StaleConversation[]) ?? [];
  },
  enqueue: enqueueTurn,
});

export const escalationWatchdogDeps = (): EscalationWatchdogDeps => ({
  getStuck: async () => {
    const { data, error } = await supabaseAdmin.rpc(
      "aarogya_stuck_escalations",
      { p_hours: 24, p_limit: 25 },
    );
    if (error) {
      log.error("aarogya_stuck_escalations failed", error.message);
      return [];
    }
    return (data as StuckEscalation[]) ?? [];
  },
});
