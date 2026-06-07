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
import { HISTORY_LIMIT } from "@/lib/agent/config";
import { SERVICE_DISPLAY, type EscalateToOpsInput } from "@/lib/agent/types";
import { log, maskPhone } from "@/lib/whatsapp/log";
import {
  extractInboundMessages,
  type NormalizedInbound,
  type WebhookEnvelope,
} from "@/types/whatsapp";

const LEAD_ALERT_TEMPLATE = "aarogya_lead_alert";
const AGENT_FALLBACK =
  "Sorry, I'm having a brief issue on my end. A Sanocare coordinator will " +
  "reach out shortly. — Aarogya";

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

  await writeAudit({
    conversationId: conversation.id,
    eventType: AuditEvent.MESSAGE_RECEIVED,
    eventData: { type: inbound.type, provider_message_id: inbound.providerMessageId },
  });

  // ---- "Mark as Attended" button reply (from the ops number) -------------
  if (isButtonReply && inbound.contextId) {
    const escId = await markEscalationAttended(inbound.contextId, inbound.phone);
    log.info(
      escId ? "escalation marked attended" : "button reply matched no open escalation",
      maskPhone(inbound.phone),
    );
    await writeAudit({
      conversationId: conversation.id,
      eventType: AuditEvent.OPS_ATTENDED,
      eventData: { escalation_id: escId, context_id: inbound.contextId, matched: Boolean(escId) },
    });
    return;
  }

  // ---- Non-text (and not a handled button): log-and-skip -----------------
  if (inbound.type !== "text") {
    log.info("non-text message recorded; no handler", inbound.type);
    await writeAudit({
      conversationId: conversation.id,
      eventType: AuditEvent.UNSUPPORTED_MESSAGE_RECEIVED,
      eventData: { type: inbound.type },
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
    await writeAudit({
      conversationId: conversation.id,
      eventType: AuditEvent.EMERGENCY_DETECTED,
      eventData: { keyword: emergency.keyword, category: emergency.category },
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
    await writeAudit({
      conversationId: conversation.id,
      eventType: AuditEvent.OPT_OUT_SET,
      eventData: { keyword: optOut.keyword },
    });
    return;
  }

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
    });
    reply = res.replyText;
    toolCalls = res.toolCalls.map((t) => ({ name: t.name, input: t.input }));
    model = res.modelUsed;
    tokensIn = res.tokensIn;
    tokensOut = res.tokensOut;
  } catch (err) {
    log.error("agent turn failed", maskPhone(inbound.phone), err);
    await writeAudit({
      conversationId: conversation.id,
      eventType: AuditEvent.AGENT_ERROR,
      eventData: { error: err instanceof Error ? err.message : "unknown" },
    });
    await dispatchTextMessage({
      conversationId: conversation.id,
      phone: inbound.phone,
      body: AGENT_FALLBACK,
    });
    return;
  }

  const willOptOut = toolCalls.some((t) => t.name === "set_opt_out");
  const willEscalate = toolCalls.some((t) => t.name === "escalate_to_ops");

  // Pick the user-facing reply. It MUST be sent before set_opt_out flips the gate.
  if (!reply) {
    if (willOptOut) reply = OPT_OUT_CONFIRMATION;
    else if (willEscalate) reply = "Got it — a Sanocare coordinator will call you shortly. 🙏";
  }
  if (reply) {
    await dispatchTextMessage({
      conversationId: conversation.id,
      phone: inbound.phone,
      body: reply,
      safetyFlags: { agent: true, model },
    });
  }

  // Execute tool calls AFTER the reply (so opt-out can't block the confirmation).
  for (const call of toolCalls) {
    try {
      if (call.name === "escalate_to_ops") {
        await executeEscalateToOps(
          conversation,
          inbound.phone,
          call.input as unknown as EscalateToOpsInput,
        );
      } else if (call.name === "set_opt_out") {
        await executeSetOptOut(conversation);
      } else {
        log.warn("unknown tool call ignored", call.name);
      }
    } catch (err) {
      log.error("tool execution failed", call.name, err);
    }
  }

  await writeAudit({
    conversationId: conversation.id,
    eventType: AuditEvent.AGENT_RESPONSE,
    eventData: {
      model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      tools: toolCalls.map((t) => t.name),
    },
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
