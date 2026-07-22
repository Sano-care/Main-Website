// Slice 2b — hardened outbound sender.
//
// Composes the new pieces into the two outbound primitives the agent uses:
//   sendHardenedText     — free-form, gated by the 24h session window
//   sendHardenedTemplate — pre-approved template (outside the window)
//
// Both: dedupe (idempotency) → [session window for text] → classify + retry
// transient failures → persist the message row → emit differentiated audit
// events. Neither throws to the caller; both return a discriminated result.
//
// The opt-out hard-block still lives in db.ts (dispatchTextMessage re-reads
// opt_out before calling here), so nothing reaches the Cloud API without
// passing that gate.

import {
  sendTemplateMessage,
  sendTextMessage,
  CloudApiError,
} from "@/lib/whatsapp/cloud-api";
import {
  classifySendError,
  TransientSendError,
  WhatsAppSendError,
} from "@/lib/whatsapp/errors";
import { withBackoff, type BackoffOptions } from "@/lib/whatsapp/retry";
import {
  computeIdempotencyKey,
  findRecentByIdempotencyKey,
} from "@/lib/whatsapp/idempotency";
import { getSessionWindow } from "@/lib/whatsapp/session";
import { renderTemplate, type TemplateName } from "@/lib/whatsapp/templates";
import { AuditEvent, writeAudit } from "@/lib/whatsapp/safety/audit";
import { supabaseAdmin } from "@/lib/supabase-server";
import { log, maskPhone } from "@/lib/whatsapp/log";

export type HardenedSendResult =
  | { ok: true; providerMessageId?: string; attemptsUsed: number; deduped?: boolean }
  | { ok: false; reason: "session_expired" }
  | {
      ok: false;
      reason: "permanent" | "transient_exhausted";
      error: WhatsAppSendError;
      attemptsUsed: number;
    };

/** Claude turn telemetry stamped on the outbound message row (columns from 035). */
export interface OutboundTelemetry {
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
}

interface CommonOpts {
  /** Injectable clock (ms) for tests. */
  clock?: () => number;
  /** Injectable backoff knobs for tests (sleep/random/budget). */
  backoff?: Partial<BackoffOptions>;
  safetyFlags?: Record<string, unknown>;
  /** Model + token counts for the composing turn, when this is an agent reply. */
  telemetry?: OutboundTelemetry;
}

/** Normalize any thrown value into a classified WhatsAppSendError. */
function toSendError(e: unknown): WhatsAppSendError {
  if (e instanceof WhatsAppSendError) return e;
  if (e instanceof CloudApiError) {
    return classifySendError({
      status: e.status,
      code: e.code,
      subcode: e.subcode,
      fbtraceId: e.fbtraceId,
      retryAfter: e.retryAfter,
      network: e.network,
      message: e.message,
    });
  }
  return classifySendError({ message: e instanceof Error ? e.message : String(e) });
}

export async function persistOutbound(args: {
  conversationId: string;
  content: string;
  contentType: string;
  providerMessageId?: string;
  idempotencyKey: string;
  safetyFlags?: Record<string, unknown>;
  telemetry?: OutboundTelemetry;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("messages").insert({
    conversation_id: args.conversationId,
    direction: "outbound",
    content: args.content,
    content_type: args.contentType,
    provider_message_id: args.providerMessageId ?? null,
    idempotency_key: args.idempotencyKey,
    safety_flags: args.safetyFlags ?? {},
    // Telemetry columns (035). Populated only on agent replies; null otherwise
    // (deterministic/template sends have no Claude turn). Makes drop-rate +
    // latency measurable — every outbound row was NULL before this.
    claude_model_used: args.telemetry?.model ?? null,
    claude_tokens_in: args.telemetry?.tokensIn ?? null,
    claude_tokens_out: args.telemetry?.tokensOut ?? null,
  });
  if (error) {
    // A unique-violation here means a concurrent sender already persisted the
    // same key — benign (the send still happened). Anything else is logged.
    log.error("outbound message persist failed", error.message);
  }
  await supabaseAdmin
    .from("conversations")
    .update({
      last_bot_msg_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.conversationId);
}

/**
 * Core send+retry+audit loop shared by text and template. `send` performs one
 * Cloud API attempt; `onSuccessAudit` records the success event.
 */
async function runHardenedSend(args: {
  conversationId: string;
  phone: string;
  idempotencyKey: string;
  clock: () => number;
  backoff?: Partial<BackoffOptions>;
  send: () => Promise<{ providerMessageId?: string }>;
  onSuccessAudit: (wamid: string | undefined, attempts: number, totalMs: number) => Promise<void>;
}): Promise<HardenedSendResult> {
  const { conversationId, phone, idempotencyKey, clock } = args;
  const start = clock();
  let attempts = 0;

  try {
    const { result, attempts: used } = await withBackoff(
      async (attempt) => {
        attempts = attempt;
        await writeAudit({
          conversationId,
          eventType: AuditEvent.OUTBOUND_SEND_ATTEMPTED,
          eventData: { phone, attempt_n: attempt, idempotency_key: idempotencyKey },
        });
        try {
          return await args.send();
        } catch (e) {
          const classified = toSendError(e);
          if (classified instanceof TransientSendError) {
            await writeAudit({
              conversationId,
              eventType: AuditEvent.OUTBOUND_SEND_FAILED_TRANSIENT,
              eventData: {
                phone,
                attempt_n: attempt,
                error_code: classified.code,
                classification: classified.classification,
              },
            });
          }
          throw classified;
        }
      },
      { maxAttempts: 3, baseMs: 1000, budgetMs: 10_000, now: clock, ...args.backoff },
    );

    await args.onSuccessAudit(result.providerMessageId, used, clock() - start);
    return { ok: true, providerMessageId: result.providerMessageId, attemptsUsed: used };
  } catch (err) {
    const e = toSendError(err);
    await writeAudit({
      conversationId,
      eventType: AuditEvent.OUTBOUND_SEND_FAILED_PERMANENT,
      eventData: {
        phone,
        error_code: e.code ?? null,
        error_subcode: e.subcode ?? null,
        fbtrace_id: e.fbtraceId ?? null,
        classification: e.classification,
        attempts_used: attempts,
        total_ms: clock() - start,
      },
    });
    log.error("outbound send terminal failure", maskPhone(phone), e.classification);
    return {
      ok: false,
      reason: e instanceof TransientSendError ? "transient_exhausted" : "permanent",
      error: e,
      attemptsUsed: attempts,
    };
  }
}

/**
 * Send a free-form text message with dedupe, 24h-window enforcement, retry, and
 * differentiated audit. Returns `{ ok:false, reason:"session_expired" }` when
 * the window has closed — the caller should fall back to sendHardenedTemplate.
 */
export async function sendHardenedText(
  args: { conversationId: string; phone: string; body: string } & CommonOpts,
): Promise<HardenedSendResult> {
  const clock = args.clock ?? Date.now;
  const key = computeIdempotencyKey(args.conversationId, args.body, clock());

  const dup = await findRecentByIdempotencyKey(key, clock());
  if (dup) {
    log.info("outbound deduped (idempotency hit)", maskPhone(args.phone));
    return { ok: true, providerMessageId: dup.providerMessageId ?? undefined, attemptsUsed: 0, deduped: true };
  }

  const window = await getSessionWindow(args.conversationId, clock());
  if (!window.open) {
    await writeAudit({
      conversationId: args.conversationId,
      eventType: AuditEvent.OUTBOUND_SESSION_EXPIRED,
      eventData: { phone: args.phone, last_user_msg_at: window.lastUserMsgAt, age_ms: window.ageMs },
    });
    return { ok: false, reason: "session_expired" };
  }

  return runHardenedSend({
    conversationId: args.conversationId,
    phone: args.phone,
    idempotencyKey: key,
    clock,
    backoff: args.backoff,
    send: () => sendTextMessage({ to: args.phone, body: args.body }),
    onSuccessAudit: async (wamid, attempts, totalMs) => {
      await persistOutbound({
        conversationId: args.conversationId,
        content: args.body,
        contentType: "text",
        providerMessageId: wamid,
        idempotencyKey: key,
        safetyFlags: args.safetyFlags,
        telemetry: args.telemetry,
      });
      await writeAudit({
        conversationId: args.conversationId,
        eventType: AuditEvent.OUTBOUND_SENT,
        eventData: { phone: args.phone, wamid: wamid ?? null, attempts_used: attempts, total_ms: totalMs },
      });
    },
  });
}

/**
 * Send a pre-approved template (used outside the 24h window). No session check
 * (templates are exactly what you send when the window is closed). Same dedupe,
 * retry, and audit; success emits `outbound_template_sent` with the vars_hash
 * (never the raw vars).
 */
export async function sendHardenedTemplate(
  args: {
    conversationId: string;
    phone: string;
    templateName: TemplateName;
    vars: Record<string, string>;
    quickReplyPayload?: string;
  } & CommonOpts,
): Promise<HardenedSendResult> {
  const clock = args.clock ?? Date.now;
  const rendered = renderTemplate(args.templateName, args.vars, {
    quickReplyPayload: args.quickReplyPayload,
  });

  // Dedupe key uses the rendered params so identical template+vars in the same
  // minute don't double-send.
  const key = computeIdempotencyKey(
    args.conversationId,
    `tmpl:${rendered.templateName}:${rendered.bodyParams.join("|")}`,
    clock(),
  );
  const dup = await findRecentByIdempotencyKey(key, clock());
  if (dup) {
    return { ok: true, providerMessageId: dup.providerMessageId ?? undefined, attemptsUsed: 0, deduped: true };
  }

  return runHardenedSend({
    conversationId: args.conversationId,
    phone: args.phone,
    idempotencyKey: key,
    clock,
    backoff: args.backoff,
    send: () =>
      sendTemplateMessage({
        to: args.phone,
        templateName: rendered.templateName,
        languageCode: rendered.languageCode,
        bodyParams: rendered.bodyParams,
        quickReplyPayload: rendered.quickReplyPayload,
      }),
    onSuccessAudit: async (wamid, attempts, totalMs) => {
      await persistOutbound({
        conversationId: args.conversationId,
        content: `[template:${rendered.templateName}]`,
        contentType: "template",
        providerMessageId: wamid,
        idempotencyKey: key,
        safetyFlags: args.safetyFlags,
      });
      await writeAudit({
        conversationId: args.conversationId,
        eventType: AuditEvent.OUTBOUND_TEMPLATE_SENT,
        eventData: {
          phone: args.phone,
          template_name: rendered.templateName,
          language: rendered.languageCode,
          vars_hash: rendered.varsHash,
          wamid: wamid ?? null,
          attempts_used: attempts,
          total_ms: totalMs,
        },
      });
    },
  });
}
