// Append-only audit logger (architecture §3.4, safety rule #5).
//
// Every significant event writes exactly one immutable row to public.audit_log.
// This module ONLY inserts — it never updates or deletes. audit_log lives in
// the database, so full phone numbers are permitted in event_data (rule #6:
// "Full numbers only in DB"). Never put secrets in event_data.
//
// Audit writes are best-effort with respect to the user-facing flow: a failed
// audit insert is logged loudly but must not throw and break message handling.
// (A dropped echo is worse than a dropped audit row; both are alerted on.)

import { supabaseAdmin } from "@/lib/supabase-server";
import { log } from "@/lib/whatsapp/log";

export const AuditEvent = {
  MESSAGE_RECEIVED: "message_received",
  MESSAGE_ECHOED: "message_echoed",
  EMERGENCY_DETECTED: "emergency_detected",
  OPT_OUT_SET: "opt_out_set",
  OPT_OUT_SEND_BLOCKED: "opt_out_send_blocked",
  HUMAN_REQUESTED: "human_requested",
  ESCALATION_CREATED: "escalation_created",
  SIGNATURE_VERIFICATION_FAILED: "signature_verification_failed",
  UNSUPPORTED_MESSAGE_RECEIVED: "unsupported_message_received",
  OUTBOUND_SEND_FAILED: "outbound_send_failed",
  // Slice 2b — sender hardening: differentiated outbound lifecycle events.
  OUTBOUND_SEND_ATTEMPTED: "outbound_send_attempted",
  OUTBOUND_SENT: "outbound_sent",
  OUTBOUND_SEND_FAILED_TRANSIENT: "outbound_send_failed_transient",
  OUTBOUND_SEND_FAILED_PERMANENT: "outbound_send_failed_permanent",
  OUTBOUND_SESSION_EXPIRED: "outbound_session_expired",
  OUTBOUND_TEMPLATE_SENT: "outbound_template_sent",
  // Week 2 (LLM)
  AGENT_RESPONSE: "agent_response",
  AGENT_ERROR: "agent_error",
  OPS_ALERT_SENT: "ops_alert_sent",
  OPS_ATTENDED: "ops_attended",
} as const;

export type AuditEventType = (typeof AuditEvent)[keyof typeof AuditEvent];

export interface AuditEntry {
  /** Null for events with no conversation (e.g. signature failures). */
  conversationId?: string | null;
  eventType: AuditEventType;
  eventData?: Record<string, unknown>;
}

/**
 * Append one row to audit_log. Best-effort: returns true on success, false on
 * failure (logged), never throws.
 */
export async function writeAudit(entry: AuditEntry): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from("audit_log").insert({
      conversation_id: entry.conversationId ?? null,
      event_type: entry.eventType,
      event_data: entry.eventData ?? {},
    });
    if (error) {
      log.error("audit insert failed", entry.eventType, error.message);
      return false;
    }
    return true;
  } catch (err) {
    log.error("audit insert threw", entry.eventType, err);
    return false;
  }
}
