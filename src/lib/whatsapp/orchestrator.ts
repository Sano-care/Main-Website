// Week-1 conversation orchestrator: the deterministic pre-check + echo router.
//
// Pipeline per inbound message (architecture §4.1):
//   1. find-or-create conversation (+ lead)
//   2. record inbound message (idempotent on wamid)  -> audit message_received
//   3. PRE-CHECKS (deterministic, never LLM, run before echo):
//        a. emergency keyword scan -> 112 response + Slack + escalation, STOP
//        b. opt-out keyword scan   -> confirmation + set opt_out, STOP
//   4. echo bot (proves the end-to-end pipe)
//
// No Claude call exists in Week 1. The opt_out send-block is enforced inside
// dispatchTextMessage, so even the echo path is safe for an opted-out user.

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
  createEscalation,
  dispatchTextMessage,
  findOrCreateConversation,
  recordInboundMessage,
  setOptOut,
} from "@/lib/whatsapp/db";
import { sendEmergencyAlert } from "@/lib/slack/alerts";
import { log, maskPhone } from "@/lib/whatsapp/log";
import {
  extractInboundMessages,
  type NormalizedInbound,
  type WebhookEnvelope,
} from "@/types/whatsapp";

/** Process one normalized inbound message end-to-end. */
export async function handleInboundMessage(
  inbound: NormalizedInbound,
): Promise<void> {
  const { conversation } = await findOrCreateConversation(inbound.phone);
  const text = inbound.text ?? "";

  // Pre-compute deterministic signals so they ride along on the message row.
  const emergency = inbound.type === "text" ? detectEmergency(text) : { matched: false as const };
  const optOut = inbound.type === "text" ? detectOptOut(text) : { matched: false as const };

  const { inserted } = await recordInboundMessage({
    conversationId: conversation.id,
    inbound,
    safetyFlags: {
      emergency_detected: emergency.matched,
      opt_out_detected: optOut.matched,
    },
  });

  // Idempotency: a Meta retry of an already-stored message is a no-op.
  if (!inserted) return;

  await writeAudit({
    conversationId: conversation.id,
    eventType: AuditEvent.MESSAGE_RECEIVED,
    eventData: { type: inbound.type, provider_message_id: inbound.providerMessageId },
  });

  // Non-text messages: log-and-skip in Week 1 (no echo, no crash).
  if (inbound.type !== "text") {
    log.info("non-text message recorded; no Week-1 handler", inbound.type);
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

    // 112 response (subject to the opt-out gate inside the dispatcher).
    await dispatchTextMessage({
      conversationId: conversation.id,
      phone: inbound.phone,
      body: EMERGENCY_RESPONSE,
      safetyFlags: { emergency_response: true, keyword: emergency.keyword },
    });

    // Ops alert + escalation row fire regardless of send outcome — a human
    // must call the patient even if we couldn't message them.
    await sendEmergencyAlert({
      conversationId: conversation.id,
      phone: inbound.phone,
      messageText: text,
      timestampMs: Number(inbound.timestamp) * 1000 || Date.now(),
      keyword: emergency.keyword,
    });
    await createEscalation({
      conversationId: conversation.id,
      escalationType: "emergency",
      priority: "p1",
    });
    await writeAudit({
      conversationId: conversation.id,
      eventType: AuditEvent.EMERGENCY_DETECTED,
      eventData: { keyword: emergency.keyword, category: emergency.category },
    });
    return; // skip echo
  }

  // ---- Pre-check b: OPT-OUT (deterministic) ------------------------------
  if (optOut.matched) {
    log.info("opt-out detected", maskPhone(inbound.phone), optOut.keyword);

    // Send the confirmation FIRST, while opt_out is still false, then flip the
    // permanent block. No override flag is needed (safety rule #4).
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
    return; // skip echo
  }

  // ---- Echo bot (Week-1 end-to-end proof) --------------------------------
  const result = await dispatchTextMessage({
    conversationId: conversation.id,
    phone: inbound.phone,
    body: `[echo] ${text}`,
  });

  if (result.sent) {
    await writeAudit({
      conversationId: conversation.id,
      eventType: AuditEvent.MESSAGE_ECHOED,
      eventData: { provider_message_id: result.providerMessageId },
    });
  }
}

/**
 * Process a full validated webhook envelope. Each message is handled
 * independently; one failure is logged and does not sink the batch (so Meta
 * still gets its 200 and we don't reprocess the whole batch on retry).
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
