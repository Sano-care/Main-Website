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
  loadHistory,
  markEscalationAttended,
  recordInboundMessage,
  setEscalationProviderMessageId,
  setOptOut,
  updateLeadFields,
  type ConversationRow,
} from "@/lib/whatsapp/db";
import { sendTemplateMessage } from "@/lib/whatsapp/cloud-api";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import { isPatientRole, runPatientPhotoConsumer } from "@/lib/whatsapp/photoConsumer";
import { HISTORY_LIMIT } from "@/lib/agent/config";
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

const LEAD_ALERT_TEMPLATE = "aarogya_lead_alert";
const AGENT_FALLBACK =
  "Sorry, I'm having a brief issue on my end. Our team will reach out " +
  "shortly, or you can call +91 97119 77782 anytime. — Aarogya";

// ---------------------------------------------------------------------------
// Ops handoff (WhatsApp template to the founder's number). NOT gated by the
// patient opt_out (it's a send to OPS, a different number). Best-effort.
// ---------------------------------------------------------------------------
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
  const opsNumber = process.env.MY_PERSONAL_WHATSAPP;
  if (!opsNumber) {
    log.warn("MY_PERSONAL_WHATSAPP unset — ops handoff skipped");
    return;
  }
  try {
    const { providerMessageId } = await sendTemplateMessage({
      to: opsNumber,
      templateName: LEAD_ALERT_TEMPLATE,
      bodyParams: [
        args.patientName,
        args.patientAge,
        args.serviceDisplay,
        args.location,
        args.context,
        args.patientMobile,
      ],
      quickReplyPayload: args.escalationId ?? undefined,
    });
    if (args.escalationId && providerMessageId) {
      await setEscalationProviderMessageId(args.escalationId, providerMessageId);
    }
    await writeAudit({
      conversationId: args.conversationId,
      eventType: AuditEvent.OPS_ALERT_SENT,
      eventData: { escalation_id: args.escalationId, wamid: providerMessageId },
    });
  } catch (err) {
    log.error("ops handoff template send failed", err);
  }
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
): Promise<void> {
  const priority = priorityFor(input);
  const isQualified = input.escalation_type === "qualified_lead";

  await updateLeadFields(conversation.lead_id, {
    name: input.patient_name || null,
    area: input.location || null,
    service_intent: input.service_intent,
    urgency: input.urgency,
    patient_relationship: input.patient_relationship,
    ...(isQualified ? { qualified_at: new Date().toISOString() } : {}),
  });

  const escalationId = await createEscalation({
    conversationId: conversation.id,
    escalationType: input.escalation_type,
    priority,
    newState: isQualified ? "qualified" : "escalated",
  });

  await sendOpsHandoff({
    conversationId: conversation.id,
    escalationId,
    patientName: input.patient_name || "Unknown",
    patientAge: input.patient_age || "—",
    serviceDisplay: SERVICE_DISPLAY[input.service_intent] ?? "Other",
    location: input.location || "—",
    context: input.context || input.summary_for_ops || "—",
    patientMobile: patientPhone,
  });
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
  const text = inbound.text ?? "";

  const isButtonReply =
    inbound.type === "button" ||
    inbound.type === "interactive" ||
    inbound.buttonPayload !== null;

  const emergency =
    inbound.type === "text" ? detectEmergency(text) : { matched: false as const };
  const optOut =
    inbound.type === "text" ? detectOptOut(text) : { matched: false as const };

  const { inserted } = await recordInboundMessage({
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
    let outcome: Awaited<ReturnType<typeof runPatientPhotoConsumer>>;
    try {
      outcome = await runPatientPhotoConsumer({ raw: inbound.raw });
    } catch (err) {
      log.error("patient photo consumer threw", maskPhone(inbound.phone), err);
      outcome = { handled: true, reply: null, visionType: null, reason: "consumer_threw" };
    }
    if (outcome.handled) {
      await audit(AuditEvent.VISION_ANALYZED, {
        type: inbound.type,
        vision_type: outcome.visionType,
        reason: outcome.reason ?? null,
      });
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

  // ---- Non-text (and not a handled button): log-and-skip -----------------
  if (inbound.type !== "text") {
    log.info("non-text message recorded; no handler", inbound.type);
    await audit(AuditEvent.UNSUPPORTED_MESSAGE_RECEIVED, { type: inbound.type });
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

  let reply = "";
  let toolCalls: { name: string; input: Record<string, unknown> }[] = [];
  let model = "";
  let tokensIn = 0;
  let tokensOut = 0;
  try {
    const res = await runAgentTurn({
      conversationId: conversation.id,
      channel: "whatsapp",
      userText: text,
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
          await executeEscalateToOps(conversation, inbound.phone, call.input as unknown as EscalateToOpsInput);
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
    await dispatchTextMessage({
      conversationId: conversation.id,
      phone: inbound.phone,
      body: reply,
      safetyFlags: { agent: true, model },
    });
  }

  // opt-out flips the permanent gate AFTER the reply is dispatched.
  if (optOutCall) await executeSetOptOut(conversation);

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
