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
  // Slice 4a — ops mode (founder phone inbound + relay flow).
  OPS_MESSAGE_RECEIVED: "ops_message_received",
  OPS_RELAY_DRAFTED: "ops_relay_drafted",
  OPS_RELAY_CONFIRMED: "ops_relay_confirmed",
  OPS_RELAY_CANCELLED: "ops_relay_cancelled",
  OPS_RELAY_EXPIRED: "ops_relay_expired",
  // Slice 3 (T66) — medic-app event → Aarogya notification dispatcher.
  MEDIC_EVENT_RECEIVED: "medic_event_received",
  MEDIC_EVENT_INSERTED: "medic_event_inserted",
  MEDIC_EVENT_IDEMPOTENT_RETURN: "medic_event_idempotent_return",
  MEDIC_EVENT_UNKNOWN_BOOKING: "medic_event_unknown_booking",
  MEDIC_EVENT_CANCELLED_BOOKING: "medic_event_cancelled_booking",
  MEDIC_EVENT_BOOKING_STATUS_UPDATED: "medic_event_booking_status_updated",
  MEDIC_EVENT_NOTIFICATION_SENT: "medic_event_notification_sent",
  MEDIC_EVENT_NOTIFICATION_FAILED: "medic_event_notification_failed",
  MEDIC_EVENT_NOTIFICATION_SKIPPED_OPTOUT: "medic_event_notification_skipped_optout",
  MEDIC_EVENT_NOTIFICATION_SKIPPED_WINDOW: "medic_event_notification_skipped_window",
  NO_SHOW_ESCALATION_PENDING: "no_show_escalation_pending",
  // The pg_cron job emits NO_SHOW_ESCALATION_FIRED and
  // NO_SHOW_RECOVERY_INBOUND directly — listed here for traceability so
  // consumers reading AuditEvent know the full Slice 3 vocabulary.
  NO_SHOW_ESCALATION_FIRED: "no_show_escalation_fired",
  NO_SHOW_RECOVERY_INBOUND: "no_show_recovery_inbound",
  // Slice 5b — CareHub proactive offer + monthly visit reminder sweeps.
  // Every send/skip/block is audited (phone-free where possible).
  CAREHUB_OFFER_SWEEP_RUN: "carehub_offer_sweep_run",
  CAREHUB_OFFER_SENT: "carehub_offer_sent",
  CAREHUB_OFFER_BLOCKED_OPTOUT: "carehub_offer_blocked_optout",
  CAREHUB_OFFER_FAILED: "carehub_offer_failed",
  CAREHUB_REMINDER_SWEEP_RUN: "carehub_reminder_sweep_run",
  CAREHUB_REMINDER_SENT: "carehub_reminder_sent",
  CAREHUB_REMINDER_SKIPPED_ALREADY_SENT: "carehub_reminder_skipped_already_sent",
  CAREHUB_REMINDER_SKIPPED_VISIT_BOOKED: "carehub_reminder_skipped_visit_booked",
  CAREHUB_REMINDER_BLOCKED_OPTOUT: "carehub_reminder_blocked_optout",
  CAREHUB_REMINDER_FAILED: "carehub_reminder_failed",
  // Emitted once per sweep when the feature flag is OFF — proves a
  // flags-off run sent NOTHING.
  CAREHUB_SKIPPED_FLAG_OFF: "carehub_skipped_flag_off",
  // Office-hours hotfix — a lead captured while Sanocare is CLOSED, flagged for
  // 9 AM follow-up (no immediate-dispatch implication).
  AFTER_HOURS_LEAD_CAPTURED: "after_hours_lead_captured",
  // Aarogya Medic Help-Mode Part 1 — medic-mode tool events.
  MEDIC_ESCALATION_TO_DOCTOR: "medic_escalation_to_doctor",
  MEDIC_QUERY: "medic_query",
  // Aarogya media + vision foundation — inbound media fetch + vision analysis.
  // Identity-aware (via the `identity` field), phone-free in event_data.
  MEDIA_RECEIVED: "media_received",
  VISION_ANALYZED: "vision_analyzed",
  // Conversation-quality + escalation hotfix.
  OPS_ALERT_FAILED: "ops_alert_failed", // every send attempt failed — loud, not swallowed
  LOCATION_RECEIVED: "location_received", // patient shared a location pin (no longer dropped)
  DUPLICATE_REPLY_SUPPRESSED: "duplicate_reply_suppressed", // debounce backstop fired
  STALLED_AUTO_ESCALATED: "stalled_auto_escalated", // turn-cap backstop fired (once per thread)
  // Pulse Records data layer (Slice A) — every read of a patient's own records
  // (bookings/Rx/vitals/meds/conditions/allergies/documents) is audited,
  // identity-aware, phone-free (counts only, never the record contents). DPDP.
  PULSE_RECORDS_FETCHED: "pulse_records_fetched",
  // Pulse Records Aarogya tools (Slice C) — a patient saving a document to
  // their vault, and asking Aarogya to explain a term/reading. Identity-aware,
  // phone-free (ids + types only, never the record/file contents). DPDP.
  PULSE_VAULT_UPLOADED: "pulse_vault_uploaded",
  PULSE_RECORD_EXPLAINED: "pulse_record_explained",
  // Patient photo & PDF interpretation — media characterised, filed, or refused.
  // Phone-free + clinical-content-free (only category + decision, never contents).
  PATIENT_PHOTO_RECEIVED: "patient_photo_received",
  PATIENT_PHOTO_FILED: "patient_photo_filed",
  PATIENT_PHOTO_REJECTED: "patient_photo_rejected",
} as const;

export type AuditEventType = (typeof AuditEvent)[keyof typeof AuditEvent];

/**
 * T-Aarogya-P1 C3 — phone-free caller identity stamped onto audit rows.
 * DPDP traceability comes from the staff/customer ID, never the raw number.
 */
export interface AuditIdentity {
  role: string;
  identifiers: { doctor_id?: string; medic_id?: string; customer_id?: string };
}

export interface AuditEntry {
  /** Null for events with no conversation (e.g. signature failures). */
  conversationId?: string | null;
  eventType: AuditEventType;
  eventData?: Record<string, unknown>;
  /**
   * Optional resolved identity. When present it is merged into the row's
   * event_data as `event_data.identity` — additive, no shape break for the
   * many callers that don't pass it.
   */
  identity?: AuditIdentity;
}

/**
 * Append one row to audit_log. Best-effort: returns true on success, false on
 * failure (logged), never throws.
 */
export async function writeAudit(entry: AuditEntry): Promise<boolean> {
  try {
    const eventData = entry.identity
      ? { ...(entry.eventData ?? {}), identity: entry.identity }
      : entry.eventData ?? {};
    const { error } = await supabaseAdmin.from("audit_log").insert({
      conversation_id: entry.conversationId ?? null,
      event_type: entry.eventType,
      event_data: eventData,
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
