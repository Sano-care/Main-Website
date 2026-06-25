// WhatsApp adapter — translates WhatsApp <-> the channel-agnostic agent brain.
//
// Pipeline per inbound message:
//   1. find-or-create conversation (+ lead), record inbound (idempotent)
//   2. "Mark as Attended" button reply  -> mark escalation acknowledged, STOP
//   3. DETERMINISTIC pre-checks (never LLM, before the brain):
//        a. emergency keyword scan -> 112 reply + ops alert + p1 escalation, STOP
//        b. opt-out keyword scan   -> confirmation + permanent opt_out, STOP
//   4. otherwise -> run the agent brain (Claude), send its reply, execute any
//      tool calls (escalate_to_ops / set_opt_out)
//
// Ops handoff is a WhatsApp TEMPLATE (aarogya_lead_alert) to the founder's
// number — Slack is retired. The escalation_id rides the template's quick-reply
// payload AND is stored as the send wamid, so the "Mark as Attended" tap maps
// back deterministically (see db.markEscalationAttended).

import {
  EMERGENCY_RESPONSE,
  detectEmergency,
} from "@/lib/whatsapp/safety/emergency-keywords";
import {
  OPT_OUT_CONFIRMATION,
  detectOptOut,
} from "@/lib/whatsapp/safety/opt-out";
import { AuditEvent, writeAudit } from "@/lib/whatsapp/safety/audit";
import { identityForAudit, resolveIdentity } from "@/lib/whatsapp/identity";
import {
  countInboundMessages,
  createEscalation,
  dispatchTextMessage,
  findOrCreateConversation,
  getEscalationStatus,
  loadHistory,
  loadRecentOutbound,
  loadUnansweredInbound,
  markEscalationAttended,
  recordInboundMessage,
  setConversationServiceIntent,
  setConversationState,
  setOptOut,
  updateLeadFields,
  type ConversationRow,
} from "@/lib/whatsapp/db";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import { isPatientRole } from "@/lib/whatsapp/photoConsumer";
import {
  runPatientMediaTurn,
  confirmPendingSave,
} from "@/lib/whatsapp/patientMediaConsumer";
import { runMedicSelfieTurn } from "@/lib/whatsapp/medicSelfieConsumer";
import {
  loadDocOwnerAndMembers,
  storePendingDocSave,
  loadOpenPendingDocSave,
} from "@/lib/whatsapp/pendingDocStore";
import { sendOpsAlert } from "@/lib/whatsapp/opsAlert";
import {
  locationFromRaw,
  synthesizeLocationText,
  coalesceInboundText,
  isDuplicateReply,
  shouldAutoEscalateStalled,
  nextState,
} from "@/lib/whatsapp/conversationQuality";
import { HISTORY_LIMIT } from "@/lib/agent/config";
import { isSanocareOpen } from "@/lib/agent/officeHours";
import { formatIST } from "@/lib/time/formatIST";
import { SERVICE_DISPLAY, type EscalateToOpsInput } from "@/lib/agent/types";
import { loadTier1Context, type ContextIdentity } from "@/lib/whatsapp/customerContext";
import {
  executeConfirmRelay,
  executeGetBookingHistory,
  executeGetFamilyMembers,
  executeRelayToPatient,
  persistConversationLanguage,
} from "@/lib/whatsapp/slice4aExecutors";
import {
  executeEscalateToDoctor,
  executeFetchBookingContext,
  executeLogMedicQuery,
} from "@/lib/whatsapp/medicExecutors";
import {
  executeRegisterCarehubInterest,
  executeSurfaceCarehubBenefits,
} from "@/lib/whatsapp/slice5Executors";
import { executeSearchLabTests } from "@/lib/whatsapp/labExecutors";
import {
  executeExplainRecord,
  executeFetchPulseRecords,
  executeUploadToPulseVault,
} from "@/lib/whatsapp/pulseExecutors";
import { mediaRefFromRaw, fetchInboundMedia } from "@/lib/whatsapp/media";
import { persistInboundOpsMedia } from "@/lib/whatsapp/opsMediaStore";
import { findLatestUnexpiredRelayDraft } from "@/lib/whatsapp/opsRouter";
import { generateResponse } from "@/lib/agent/client";
import {
  cancelBookingById,
  findBookingsByPhone,
  insertComplaint,
  mapServiceCategory,
} from "@/lib/agent/bookings";
import { log, maskPhone } from "@/lib/whatsapp/log";
import {
  extractInboundMessages,
  type NormalizedInbound,
  type WebhookEnvelope,
} from "@/types/whatsapp";

const AGENT_FALLBACK =
  "Sorry, I'm having a brief issue on my end. Our team will reach out " +
  "shortly, or you can call +91 97119 77782 anytime. — Aarogya";

// ---------------------------------------------------------------------------
// Ops handoff (WhatsApp template to the founder's number). NOT gated by the
// patient opt_out (it's a send to OPS, a different number). Best-effort.
// ---------------------------------------------------------------------------
// Thin wrapper — the hardened single source of truth lives in opsAlert.ts
// (correct target, field fallbacks, retry + alternate number, loud OPS_ALERT_FAILED).
// Kept as a named function so the medic executor's injected OpsHandoffFn and the
// other in-adapter call sites keep the same signature.
async function sendOpsHandoff(args: {
  conversationId: string;
  escalationId: string | null;
  patientName: string;
  patientAge: string;
  serviceDisplay: string;
  location: string;
  context: string;
  patientMobile: string;
}): Promise<void> {
  await sendOpsAlert(args);
}

// ---------------------------------------------------------------------------
// Tool executors.
// ---------------------------------------------------------------------------
function priorityFor(input: EscalateToOpsInput): "p1" | "p2" | "p3" {
  if (input.escalation_type === "emergency" || input.urgency === "emergency") return "p1";
  if (input.escalation_type === "stalled_conversation") return "p3";
  return "p2";
}

async function executeEscalateToOps(
  conversation: ConversationRow,
  patientPhone: string,
  input: EscalateToOpsInput,
  afterHours = false,
): Promise<void> {
  const priority = priorityFor(input);
  const isQualified = input.escalation_type === "qualified_lead";
  // Emergencies are immediate at any hour — never flag them after-hours.
  const flagAfterHours = afterHours && input.escalation_type !== "emergency";

  await updateLeadFields(conversation.lead_id, {
    name: input.patient_name || null,
    area: input.location || null,
    service_intent: input.service_intent,
    urgency: input.urgency,
    patient_relationship: input.patient_relationship,
    ...(isQualified ? { qualified_at: new Date().toISOString() } : {}),
  });

  // C5 — write the detected service onto the conversation (was NULL on every
  // row), so triage state is queryable and the thread stops looking un-triaged.
  await setConversationServiceIntent(conversation.id, input.service_intent);

  const escalationId = await createEscalation({
    conversationId: conversation.id,
    escalationType: input.escalation_type,
    priority,
    newState: isQualified ? "qualified" : "escalated",
  });

  const baseContext = input.context || input.summary_for_ops || "—";
  await sendOpsHandoff({
    conversationId: conversation.id,
    escalationId,
    patientName: input.patient_name || "Unknown",
    patientAge: input.patient_age || "—",
    serviceDisplay: SERVICE_DISPLAY[input.service_intent] ?? "Other",
    location: input.location || "—",
    // Tag so ops sees it's an after-hours capture for 9 AM follow-up, not a
    // live dispatch.
    context: flagAfterHours
      ? `[AFTER-HOURS — follow up at 9 AM] ${baseContext}`
      : baseContext,
    patientMobile: patientPhone,
  });

  if (flagAfterHours) {
    await writeAudit({
      conversationId: conversation.id,
      eventType: AuditEvent.AFTER_HOURS_LEAD_CAPTURED,
      eventData: { escalation_id: escalationId, escalation_type: input.escalation_type },
    });
  }
}

async function executeSetOptOut(conversation: ConversationRow): Promise<void> {
  await setOptOut({ conversationId: conversation.id, leadId: conversation.lead_id });
  await writeAudit({
    conversationId: conversation.id,
    eventType: AuditEvent.OPT_OUT_SET,
    eventData: { source: "llm_tool" },
  });
}

// ---------------------------------------------------------------------------
// Slice 1 tool executors (booking-aware). Each returns the patient_message the
// adapter sends. The conversation phone is injected — never trusted from the
// model. cancel_booking / log_complaint also alert ops (escalation row + WA).
// ---------------------------------------------------------------------------
interface CancelBookingInput {
  reason?: string;
  patient_acknowledged_fee?: boolean;
}
interface LogComplaintInput {
  category: string;
  narrative: string;
  severity?: "low" | "medium" | "high" | "critical";
}

const SERVICE_LABEL: Record<string, string> = {
  home_visit: "Home Visit",
  home_nursing: "Home Nursing",
  lab: "Lab Test",
  teleconsult: "Teleconsultation",
};

// Slice 2a §2 — `aarogya_lead_alert` {{5}} bracket-tag.
//
// Slice 1 made cancel_booking / log_complaint reuse the lead-alert
// template, so ops sees the "New patient lead received…" framing for
// situations that aren't leads. The agent prefixes {{5}} with an
// originating-tool tag so ops can triage at a glance — no template
// change, no Meta review. escalate_to_ops (genuine leads) is untouched.
//
// The booking-code suffix is appended only when a code resolved; a
// missing/old-row code drops the suffix entirely (never "#undefined").
function bookingTagSuffix(code: string | null | undefined): string {
  const c = code?.trim();
  return c ? ` | Booking #${c}` : "";
}

async function executeCheckMedicStatus(phone: string): Promise<string> {
  const { latest } = await findBookingsByPhone(phone);
  if (!latest) return "I don't see an active booking for this number — want me to set one up?";
  const medic = latest.assigned_paramedic?.trim() || "your Medic";
  switch (latest.status) {
    case "PENDING":
    case "PENDING_COLLECTION":
      return "Your booking is in. Ops is matching a Medic to you now — you'll get an update within a few minutes.";
    case "CONFIRMED":
      return "Medic confirmed for your booking. They'll be on the way shortly.";
    case "DISPATCHED":
      return `Your Medic (${medic}) has been dispatched. They'll reach you within 30 minutes — call +91 97119 77782 if you need to coordinate.`;
    case "COMPLETED":
      return "Looks like that visit is already complete. Was there something specific from it I can help with?";
    case "CANCELLED":
      return "That booking was cancelled. Want me to set up a new one?";
    default:
      return "Your booking is in — you'll get an update shortly.";
  }
}

async function executeCancelBooking(
  conversation: ConversationRow,
  phone: string,
  input: CancelBookingInput,
): Promise<string> {
  const { latest, latestActive } = await findBookingsByPhone(phone);
  const target = latestActive ?? latest;
  if (!target) return "I don't see an active booking for this number.";
  if (target.status === "CANCELLED") return "That booking was already cancelled.";
  if (target.status === "COMPLETED") {
    return "That visit is already complete, so I can't cancel it. If there's a quality concern, I can log a complaint instead — want me to do that?";
  }
  // cancellable (PENDING / PENDING_COLLECTION / CONFIRMED / DISPATCHED)
  if (!input.patient_acknowledged_fee) {
    return "Just to confirm — cancelling now is free, since the Medic hasn't completed the visit. Reply 'yes cancel' and I'll process it.";
  }
  const reason = input.reason?.trim() || "patient requested cancellation";
  const ok = await cancelBookingById(target.id, reason);
  if (!ok) return "Sorry, I hit a snag cancelling that. Please call +91 97119 77782 and we'll sort it out.";
  const escId = await createEscalation({
    conversationId: conversation.id,
    escalationType: "cancellation",
    priority: "p2",
  });
  await sendOpsHandoff({
    conversationId: conversation.id,
    escalationId: escId,
    patientName: "(cancellation)",
    patientAge: "—",
    serviceDisplay: SERVICE_LABEL[mapServiceCategory(target.service_category)] ?? "Booking",
    location: "—",
    // {{5}} — bracket-tagged so ops sees this is a cancellation, not a
    // lead. Only the free-text reason is bounded; tag + booking suffix
    // always survive.
    context: `[CANCELLATION] Reason: ${reason.slice(0, 120)}${bookingTagSuffix(target.booking_code)}`,
    patientMobile: phone,
  });
  return "Done — booking cancelled, no charge. Sorry we couldn't help today. Message anytime if you need us again.";
}

async function executeLogComplaint(
  conversation: ConversationRow,
  phone: string,
  input: LogComplaintInput,
): Promise<string> {
  const severity = input.severity ?? "medium";
  const { latest } = await findBookingsByPhone(phone);
  await insertComplaint({
    phone,
    bookingId: latest?.id ?? null,
    category: input.category,
    narrative: input.narrative,
    severity,
  });
  const priority = severity === "high" || severity === "critical" ? "p1" : "p2";
  const escId = await createEscalation({
    conversationId: conversation.id,
    escalationType: "complaint",
    priority,
  });
  await sendOpsHandoff({
    conversationId: conversation.id,
    escalationId: escId,
    patientName: "(complaint)",
    patientAge: "—",
    serviceDisplay: `Complaint: ${input.category}`,
    location: "—",
    // {{5}} — bracket-tagged with the complaint category so ops triages
    // at a glance. Category passed verbatim (the 6-value enum); only the
    // free-text narrative is bounded so tag + booking suffix survive.
    context: `[COMPLAINT — ${input.category}] ${input.narrative.slice(0, 120)}${bookingTagSuffix(latest?.booking_code)}`,
    patientMobile: phone,
  });
  return "Got it — I've logged this for our team. Someone will respond within 4 hours. If anything's urgent, call +91 97119 77782.";
}

// ---------------------------------------------------------------------------
// Main per-message handler.
// ---------------------------------------------------------------------------
export async function handleInboundMessage(
  inbound: NormalizedInbound,
): Promise<void> {
  const { conversation } = await findOrCreateConversation(inbound.phone);

  // C2 — location pin: don't drop it. Synthesise a structured note so the agent
  // turn acknowledges the pin and keeps qualifying (a shared location used to be
  // silently dropped, killing every in-person booking at the location step).
  const locationPin =
    inbound.type === "location" ? locationFromRaw(inbound.raw) : null;
  const text =
    inbound.type === "location" && locationPin
      ? synthesizeLocationText(locationPin)
      : (inbound.text ?? "");

  const isButtonReply =
    inbound.type === "button" ||
    inbound.type === "interactive" ||
    inbound.buttonPayload !== null;

  const emergency =
    inbound.type === "text" ? detectEmergency(text) : { matched: false as const };
  const optOut =
    inbound.type === "text" ? detectOptOut(text) : { matched: false as const };

  const { inserted, messageId } = await recordInboundMessage({
    conversationId: conversation.id,
    inbound,
    safetyFlags: {
      emergency_detected: emergency.matched,
      opt_out_detected: optOut.matched,
      button_reply: isButtonReply,
    },
  });
  if (!inserted) return; // idempotent: Meta retry

  // ---- Identity resolution (T-Aarogya-P1 C2/C3) --------------------------
  // Resolve WHO this number is, ONCE, at conversation start (after the
  // idempotency guard so Meta retries don't re-query). Adapter-injected into
  // the orchestrator turn + stamped on every audit row from here on — the
  // model never sees the raw phone, only the role + IDs. The single resolved
  // value threaded through the handler IS the conversation-scoped cache.
  const identity = await resolveIdentity(inbound.phone);
  const auditIdentity = identityForAudit(identity);

  // Reconciliation (#98 ↔ #97): the deterministic patient-media consumer below
  // OWNS inbound patient image AND document (classify → identity-gate → consent
  // → file via the canonical uploadToPulseVault). #97's "registered document →
  // agent turn (upload_to_pulse_vault tool)" auto-routing is removed so a doc is
  // never double-handled; the tool itself stays for text-driven save requests.
  const audit = (
    eventType: (typeof AuditEvent)[keyof typeof AuditEvent],
    eventData?: Record<string, unknown>,
  ) =>
    writeAudit({
      conversationId: conversation.id,
      eventType,
      eventData,
      identity: auditIdentity,
    });

  await audit(AuditEvent.MESSAGE_RECEIVED, {
    type: inbound.type,
    provider_message_id: inbound.providerMessageId,
  });

  // ---- "Mark as Attended" button reply (from the ops number) -------------
  if (isButtonReply && inbound.contextId) {
    const escId = await markEscalationAttended(inbound.contextId, inbound.phone);
    log.info(
      escId ? "escalation marked attended" : "button reply matched no open escalation",
      maskPhone(inbound.phone),
    );
    await audit(AuditEvent.OPS_ATTENDED, {
      escalation_id: escId,
      context_id: inbound.contextId,
      matched: Boolean(escId),
    });
    return;
  }

  // ---- Patient photo acknowledgment (media + vision foundation, Consumer 0)
  // A patient sending an image/document: fetch + ONE vision call (characterise,
  // never interpret) → a compliant ack. Storage-light; never throws. Other
  // identities (doctor/medic/ops) fall through to the non-text drop below —
  // selfie/vault consumers are separate PRs.
  if (
    (inbound.type === "image" || inbound.type === "document") &&
    isPatientRole(identity)
  ) {
    await audit(AuditEvent.MEDIA_RECEIVED, { type: inbound.type });
    // Fetch the media bytes ONCE, here: persist the ops-viewing copy to ops-media
    // (3-day TTL, so ops/founder can verify a selfie/report in /ops/conversations),
    // then hand the SAME bytes to the consumer — no double fetch.
    const mediaRef = mediaRefFromRaw(inbound.raw);
    const prefetched = mediaRef ? await fetchInboundMedia(mediaRef.mediaId) : null;
    if (mediaRef && prefetched?.ok) {
      try {
        await persistInboundOpsMedia({
          messageId,
          conversationId: conversation.id,
          senderRole: "customer",
          mediaKind: inbound.type === "document" ? "document" : "image",
          mediaId: mediaRef.mediaId,
          bytes: prefetched.bytes,
          mimeType: prefetched.mimeType,
        });
      } catch (err) {
        // Ops-media persistence is best-effort — never block the patient flow.
        log.error("persistInboundOpsMedia failed", maskPhone(inbound.phone), err);
      }
    }
    let outcome: Awaited<ReturnType<typeof runPatientMediaTurn>>;
    try {
      outcome = await runPatientMediaTurn(
        { raw: inbound.raw, identity, prefetched: prefetched ?? undefined },
        { loadOwner: (cid) => loadDocOwnerAndMembers(cid) },
      );
    } catch (err) {
      log.error("patient media consumer threw", maskPhone(inbound.phone), err);
      outcome = {
        handled: true,
        reply: "I got your file but couldn't process it just now — tell me what you need and I'll help.",
        audits: [],
      };
    }
    if (outcome.handled) {
      for (const a of outcome.audits) await audit(a.event, a.data);
      // Stash the pending save (audit_log) so the patient's YES/NO next turn files it.
      if (outcome.pending) await storePendingDocSave(conversation.id, outcome.pending);
      if (outcome.reply) {
        await dispatchTextMessage({
          conversationId: conversation.id,
          phone: inbound.phone,
          body: outcome.reply,
        });
      }
      return;
    }
    // Unhandled (no media ref) — fall through to the non-text drop.
  }

  // ---- Medic on-duty selfie (Medic Help-Mode Part 2) ----------------------
  // SIBLING of the patient media branch (one media path). A medic's image is
  // their attendance selfie: set selfie_verified_at on today's row → the
  // post_medic_earnings_on_attendance trigger posts the daily wage. medic_id is
  // taken from the injected identity (never model input); the consumer re-gates
  // role==='medic'. Storage-light, never throws.
  if (inbound.type === "image" && identity.role === "medic") {
    await audit(AuditEvent.MEDIA_RECEIVED, { type: inbound.type });
    let selfie: Awaited<ReturnType<typeof runMedicSelfieTurn>>;
    try {
      selfie = await runMedicSelfieTurn({ raw: inbound.raw, identity });
    } catch (err) {
      log.error("medic selfie consumer threw", maskPhone(inbound.phone), err);
      selfie = {
        reply:
          "I got your selfie but couldn't process it just now — please try again, or call +91 97119 77782.",
        audits: [],
      };
    }
    for (const a of selfie.audits) await audit(a.event, a.data);
    await dispatchTextMessage({
      conversationId: conversation.id,
      phone: inbound.phone,
      body: selfie.reply,
    });
    return;
  }

  // ---- Location pin → record + flow into the agent turn (C2) --------------
  if (inbound.type === "location" && locationPin) {
    await audit(AuditEvent.LOCATION_RECEIVED, {
      lat: locationPin.lat,
      lng: locationPin.lng,
      has_address: Boolean(locationPin.address ?? locationPin.name),
    });
    // falls through to the agent turn below with the synthesised `text`.
  } else if (inbound.type !== "text") {
    // ---- Non-text with no consumer (e.g. a document from a medic, media from a
    // role with no handler). NEVER drop silently — a zero-output turn stalls the
    // thread (the same fragility class as the Part 1 selfie defect that left
    // conv a6ad2df7 stuck at 'greeting'). Send a minimal fallback so there is
    // always exactly one outbound. ----
    log.info("non-text message with no handler — sending fallback", inbound.type);
    await audit(AuditEvent.UNSUPPORTED_MESSAGE_RECEIVED, { type: inbound.type });
    await dispatchTextMessage({
      conversationId: conversation.id,
      phone: inbound.phone,
      body: "Thanks! I can't open that here — please send your message as text and I'll help right away.",
    });
    return;
  }

  // ---- Pre-check a: EMERGENCY (deterministic, highest priority) ----------
  if (emergency.matched) {
    log.warn("emergency detected", maskPhone(inbound.phone), emergency.keyword);
    await dispatchTextMessage({
      conversationId: conversation.id,
      phone: inbound.phone,
      body: EMERGENCY_RESPONSE,
      safetyFlags: { emergency_response: true, keyword: emergency.keyword },
    });
    const escalationId = await createEscalation({
      conversationId: conversation.id,
      escalationType: "emergency",
      priority: "p1",
    });
    await sendOpsHandoff({
      conversationId: conversation.id,
      escalationId,
      patientName: inbound.contactName ?? "Unknown",
      patientAge: "—",
      serviceDisplay: "🚨 EMERGENCY",
      location: "—",
      context: `EMERGENCY: ${text.slice(0, 60)}`,
      patientMobile: inbound.phone,
    });
    await audit(AuditEvent.EMERGENCY_DETECTED, {
      keyword: emergency.keyword,
      category: emergency.category,
    });
    return;
  }

  // ---- Pre-check b: OPT-OUT (deterministic) ------------------------------
  if (optOut.matched) {
    log.info("opt-out detected", maskPhone(inbound.phone), optOut.keyword);
    await dispatchTextMessage({
      conversationId: conversation.id,
      phone: inbound.phone,
      body: OPT_OUT_CONFIRMATION,
      safetyFlags: { opt_out_confirmation: true },
    });
    await setOptOut({ conversationId: conversation.id, leadId: conversation.lead_id });
    await audit(AuditEvent.OPT_OUT_SET, { keyword: optOut.keyword });
    return;
  }

  // ---- Patient doc save confirmation (consented vault filing) -------------
  // If a medical doc is awaiting the patient's YES/NO, resolve it here before
  // the normal agent flow. YES → file to the vault; NO → discard; unclear →
  // fall through (never store on ambiguity — DPDP).
  if (inbound.type === "text" && isPatientRole(identity)) {
    // Defensive: a pending-store read failure must never break the patient's
    // message — fall through to the normal flow.
    const pending = await loadOpenPendingDocSave(conversation.id).catch((err) => {
      log.error("loadOpenPendingDocSave failed", maskPhone(inbound.phone), err);
      return null;
    });
    if (pending) {
      const res = await confirmPendingSave(
        { pending, text, identity },
        { loadMembers: async (cid) => (await loadDocOwnerAndMembers(cid)).members },
      );
      if (res.handled) {
        for (const a of res.audits) await audit(a.event, a.data);
        if (res.reply) {
          await dispatchTextMessage({
            conversationId: conversation.id,
            phone: inbound.phone,
            body: res.reply,
          });
        }
        return;
      }
      // unclear → fall through to the normal agent flow.
    }
  }

  // ---- Slice 4a: per-turn language detection + Tier-1 context load -------
  // Patient turns: detect + persist language so ops + relay drafts can mirror.
  // Ops turns: skip the language write (we don't want ops's English overriding
  // the patient's stored language) but still load context for the system prompt.
  if (identity.role !== "ops_founder") {
    await persistConversationLanguage(conversation.id, text);
  }
  const tier1 = await loadTier1Context(identity as ContextIdentity, inbound.phone, conversation.id);
  const pendingDraft =
    identity.role === "ops_founder"
      ? await findLatestUnexpiredRelayDraft(conversation.id)
      : null;

  // ---- Agent brain (Claude) ----------------------------------------------
  const historyPlusCurrent = await loadHistory(conversation.id, HISTORY_LIMIT + 1);
  const history = historyPlusCurrent.slice(0, -1); // drop the just-recorded current turn
  const turnCount = await countInboundMessages(conversation.id);

  // Office-hours awareness — computed once per turn so the system prompt and
  // the escalate_to_ops after-hours tag agree on the same clock.
  const officeNow = new Date();
  const isOpen = isSanocareOpen(officeNow);
  const nowIstLabel = formatIST(officeNow, "datetime");

  // C3 — coalesce a rapid burst: if more than one inbound message is unanswered
  // since the last bot reply, run ONE turn over the combined text. A single
  // message (the common case) uses the effective text as-is (handles location).
  const unanswered = await loadUnansweredInbound(conversation.id);
  const combinedText =
    unanswered.length > 1 ? coalesceInboundText(unanswered) : text;

  let reply = "";
  let toolCalls: { name: string; input: Record<string, unknown> }[] = [];
  let model = "";
  let tokensIn = 0;
  let tokensOut = 0;
  try {
    const res = await runAgentTurn({
      conversationId: conversation.id,
      channel: "whatsapp",
      userText: combinedText,
      history,
      turnCount,
      emergencyPreCheckFired: false,
      identity,
      tier1ContextBlock: {
        patient_name: tier1.customer?.full_name ?? null,
        last_booking: tier1.last_booking
          ? {
              service_category: tier1.last_booking.service_category,
              status: tier1.last_booking.status,
              created_at: tier1.last_booking.created_at,
            }
          : null,
        carehub: tier1.carehub
          ? {
              active: tier1.carehub.active,
              started_at: tier1.carehub.started_at,
              monthly_inr: tier1.carehub.monthly_inr,
            }
          : null,
        language: tier1.language,
        now_ist: nowIstLabel,
        is_open: isOpen,
      },
      pendingRelayDraftTargetPhone: pendingDraft?.targetPhone ?? null,
    });
    reply = res.replyText;
    toolCalls = res.toolCalls.map((t) => ({ name: t.name, input: t.input }));
    model = res.modelUsed;
    tokensIn = res.tokensIn;
    tokensOut = res.tokensOut;
  } catch (err) {
    log.error("agent turn failed", maskPhone(inbound.phone), err);
    await audit(AuditEvent.AGENT_ERROR, {
      error: err instanceof Error ? err.message : "unknown",
    });
    await dispatchTextMessage({
      conversationId: conversation.id,
      phone: inbound.phone,
      body: AGENT_FALLBACK,
    });
    return;
  }

  // Execute tools. Patient-message tools (status/cancel/complaint) run FIRST
  // and produce the reply; set_opt_out is deferred until AFTER the reply is
  // sent, so the opt-out confirmation isn't blocked by the permanent gate.
  let toolPatientMsg: string | null = null;
  let optOutCall = false;
  let escalateCall = false;
  for (const call of toolCalls) {
    try {
      switch (call.name) {
        case "set_opt_out":
          optOutCall = true; // deferred
          break;
        case "escalate_to_ops":
          escalateCall = true;
          await executeEscalateToOps(conversation, inbound.phone, call.input as unknown as EscalateToOpsInput, !isOpen);
          break;
        case "check_medic_status":
          toolPatientMsg = await executeCheckMedicStatus(inbound.phone);
          break;
        case "cancel_booking":
          toolPatientMsg = await executeCancelBooking(conversation, inbound.phone, call.input as unknown as CancelBookingInput);
          break;
        case "log_complaint":
          toolPatientMsg = await executeLogComplaint(conversation, inbound.phone, call.input as unknown as LogComplaintInput);
          break;
        case "get_booking_history":
          toolPatientMsg = await executeGetBookingHistory(
            inbound.phone,
            call.input as unknown as { filter?: "all" | "active" | "completed" },
          );
          break;
        case "get_family_members":
          toolPatientMsg = await executeGetFamilyMembers(identity);
          break;
        case "register_carehub_interest":
          toolPatientMsg = await executeRegisterCarehubInterest({
            identity,
            phone: inbound.phone,
            // source_message_id is nullable (M062); wiring the recorded inbound
            // message row id is a later refinement — null keeps the lead valid.
            sourceMessageId: null,
            input: call.input as unknown as { notes?: string },
          });
          break;
        case "surface_carehub_benefits":
          toolPatientMsg = await executeSurfaceCarehubBenefits(identity);
          break;
        case "search_lab_tests":
          toolPatientMsg = await executeSearchLabTests({
            identity,
            input: call.input as unknown as { query?: string },
          });
          break;
        case "relay_to_patient":
          toolPatientMsg = await executeRelayToPatient(
            {
              identity,
              opsConversationId: conversation.id,
              input: call.input as unknown as { target_phone: string; instruction: string },
            },
            {
              composeDraftBody: async ({ instruction, targetLanguage }) => {
                // Inline Claude composer call. Focused system prompt;
                // never call from patient mode (security gate above
                // already rejects there).
                const composerSystem =
                  "You are Aarogya composing ONE WhatsApp message on behalf of Sanocare ops to a patient. " +
                  "Write 3 lines max, warm + brief. " +
                  "Mirror the patient's preferred language: " +
                  (targetLanguage ?? "english") +
                  ". " +
                  "Do NOT include the AI disclosure. Do NOT add a signature. " +
                  "End with — Aarogya only if it fits in 3 lines.";
                const composerRes = await generateResponse({
                  model: "claude-haiku-4-5-20251001",
                  system: composerSystem,
                  messages: [{ role: "user", content: `Compose a message to the patient based on this instruction:\n${instruction}` }],
                  tools: [],
                  maxTokens: 256,
                });
                return composerRes.text.trim();
              },
            },
          );
          break;
        case "confirm_relay":
          toolPatientMsg = await executeConfirmRelay({
            identity,
            opsConversationId: conversation.id,
            input: call.input as unknown as { resolution: "YES" | "CANCEL" },
          });
          break;
        // ---- Medic Help-Mode Part 1 (identity adapter-injected, role-gated) ----
        case "escalate_to_doctor":
          toolPatientMsg = await executeEscalateToDoctor({
            identity,
            conversationId: conversation.id,
            medicPhone: inbound.phone,
            input: call.input as unknown as { reason?: string },
            sendOpsHandoff,
          });
          break;
        case "fetch_booking_context":
          toolPatientMsg = await executeFetchBookingContext({
            identity,
            input: call.input as unknown as { booking_id?: string },
          });
          break;
        case "log_medic_query":
          await executeLogMedicQuery({
            identity,
            conversationId: conversation.id,
            input: call.input as unknown as { question?: string },
          });
          break;
        // ---- Pulse Records tools (Slice C, identity adapter-injected) --------
        case "fetch_pulse_records":
          toolPatientMsg = await executeFetchPulseRecords({
            identity,
            conversationId: conversation.id,
            input: call.input as unknown as { categories?: string[]; member_id?: string },
          });
          break;
        case "upload_to_pulse_vault":
          toolPatientMsg = await executeUploadToPulseVault({
            identity,
            conversationId: conversation.id,
            // The document is the current inbound message's media; the model
            // never supplies it. Null on a text turn (executor asks for the file).
            media: mediaRefFromRaw(inbound.raw),
            input: call.input as unknown as { doc_type?: string; label?: string; member_id?: string },
          });
          break;
        case "explain_record":
          toolPatientMsg = await executeExplainRecord({
            identity,
            conversationId: conversation.id,
            input: call.input as unknown as { record_id?: string },
          });
          break;
        default:
          log.warn("unknown tool call ignored", call.name);
      }
    } catch (err) {
      log.error("tool execution failed", call.name, err);
    }
  }

  // Reply: a patient-message tool's message wins; else the model's text; else a closer.
  if (toolPatientMsg) reply = toolPatientMsg;
  if (!reply) {
    if (optOutCall) reply = OPT_OUT_CONFIRMATION;
    else if (escalateCall) reply = "Got it — I've got everything I need. Our team will reach you shortly.";
  }
  if (reply) {
    // C3 — debounce backstop: drop a near-duplicate of a very recent reply (a
    // concurrent turn over the same burst already answered). Kills the observed
    // "two near-identical replies" bug without a turn-lock migration.
    const recentOut = await loadRecentOutbound(conversation.id);
    if (isDuplicateReply(reply, recentOut)) {
      await audit(AuditEvent.DUPLICATE_REPLY_SUPPRESSED, { model });
    } else {
      await dispatchTextMessage({
        conversationId: conversation.id,
        phone: inbound.phone,
        body: reply,
        safetyFlags: { agent: true, model },
      });
    }
  }

  // opt-out flips the permanent gate AFTER the reply is dispatched.
  if (optOutCall) await executeSetOptOut(conversation);

  // C4 — stalled-thread backstop: a thread looping past the cap with no booking
  // or escalation auto-escalates ONCE (rate-limited by escalation_status). Runs
  // before the state write-back so it doesn't regress an escalated state.
  let escalatedThisTurn = escalateCall;
  if (!escalatedThisTurn && !optOutCall) {
    const escStatus = await getEscalationStatus(conversation.id);
    if (shouldAutoEscalateStalled({ turnCount, escalationStatus: escStatus, escalatedThisTurn: false })) {
      const escId = await createEscalation({
        conversationId: conversation.id,
        escalationType: "stalled_conversation",
        priority: "p3",
        newState: "escalated",
      });
      const ctx = `[STALLED ${turnCount} turns, no progress] ${combinedText.slice(0, 200)}`;
      await sendOpsAlert({
        conversationId: conversation.id,
        escalationId: escId,
        patientName: tier1.customer?.full_name ?? inbound.contactName ?? "—",
        patientAge: "—",
        serviceDisplay: "Stalled thread — needs a human",
        location: "—",
        context: isOpen ? ctx : `[AFTER-HOURS — follow up at 9 AM] ${ctx}`,
        patientMobile: inbound.phone,
      });
      await audit(AuditEvent.STALLED_AUTO_ESCALATED, { turn_count: turnCount });
      escalatedThisTurn = true;
    }
  }

  // C5 — state write-back: advance greeting → qualifying once a real exchange
  // happens (stops threads resetting to 'greeting'). Forward-only (nextState),
  // skipped when an escalation/opt-out already advanced the state this turn.
  if (!escalatedThisTurn && !optOutCall) {
    const advanced = nextState(conversation.state, "qualifying");
    if (advanced) await setConversationState(conversation.id, advanced);
  }

  await audit(AuditEvent.AGENT_RESPONSE, {
    model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    tools: toolCalls.map((t) => t.name),
  });
}

/**
 * Process a full validated webhook envelope. Each message is handled
 * independently; a failure is logged and never sinks the batch (Meta still
 * gets its 200, and we don't reprocess the whole batch on retry).
 */
export async function processWebhook(envelope: WebhookEnvelope): Promise<void> {
  const inbound = extractInboundMessages(envelope);
  for (const msg of inbound) {
    try {
      await handleInboundMessage(msg);
    } catch (err) {
      log.error("message handling failed", maskPhone(msg.phone), err);
    }
  }
}
