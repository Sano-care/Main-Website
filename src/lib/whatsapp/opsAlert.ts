// Conversation-quality + escalation hotfix — the SINGLE source of truth for
// sending the ops alert (aarogya_lead_alert) to the founder ops line.
//
// Consolidates the two prior senders (adapter.sendOpsHandoff +
// opsRouter.escalateToOpsPhone), which diverged: one silently SKIPPED when
// MY_PERSONAL_WHATSAPP was unset, the other defaulted to the WRONG number. Both
// now delegate here. Behaviour:
//   - Target: MY_PERSONAL_WHATSAPP override (digits) || the Ops number
//     919760059900 (= FOUNDER_OPS_PHONE_DIGITS). NEVER skips for a missing
//     override (that was the live bug); NEVER targets 919711977782 (the WABA).
//   - Field fallbacks: no {{1}}..{{6}} ever blank — "—"/"unknown" substituted.
//   - Loud failure: try the Ops number, retry once, then once more; if ALL fail,
//     write OPS_ALERT_FAILED. Never throws.

import { sendTemplateMessage } from "@/lib/whatsapp/cloud-api";
import { AuditEvent, writeAudit } from "@/lib/whatsapp/safety/audit";
import { setEscalationProviderMessageId } from "@/lib/whatsapp/db";
import { FOUNDER_OPS_PHONE_DIGITS } from "@/lib/whatsapp/constants";
import { log } from "@/lib/whatsapp/log";

const LEAD_ALERT_TEMPLATE = "aarogya_lead_alert";

// IMPORTANT: 919711977782 is Aarogya's OWN WABA number (the inbox patients text)
// — escalations must NEVER target it (that's the bot messaging itself). The Ops
// number is 919760059900 (= FOUNDER_OPS_PHONE_DIGITS). ALL escalations go there.
/** The Ops number — every escalation targets this. No env required. */
export const OPS_ALERT_TARGET_DIGITS = FOUNDER_OPS_PHONE_DIGITS; // "919760059900"
/** There is one valid Ops line, so the retry "alternate" is the same number
 *  (never the WABA). Kept as a named constant for the retry sequence + tests. */
export const OPS_ALERT_ALT_DIGITS = FOUNDER_OPS_PHONE_DIGITS; // "919760059900"

export interface OpsAlertArgs {
  /** Null for alerts not tied to a WhatsApp conversation (e.g. a marketing
   *  hot-lead alert). audit_log.conversation_id is nullable, so this is safe. */
  conversationId: string | null;
  escalationId: string | null;
  patientName: string;
  patientAge: string;
  serviceDisplay: string;
  location: string;
  context: string;
  patientMobile: string;
}

export interface OpsAlertResult {
  sent: boolean;
  providerMessageId?: string;
  target?: string;
  attempts: number;
}

export interface OpsAlertDeps {
  sendTemplate?: typeof sendTemplateMessage;
  writeAuditFn?: typeof writeAudit;
  setEscalationWamid?: typeof setEscalationProviderMessageId;
  env?: Record<string, string | undefined>;
}

/** Never blank: trims, falls back to the given placeholder. */
function orDash(v: string | null | undefined, placeholder = "—"): string {
  const t = (v ?? "").trim();
  return t ? t : placeholder;
}

function primaryTarget(env: Record<string, string | undefined>): string {
  const override = env.MY_PERSONAL_WHATSAPP?.replace(/[^\d]/g, "");
  if (override) return override;
  // The override is how prod points at a different number; log loudly when it's
  // absent so a misconfig is visible rather than silently using the default.
  log.warn(`MY_PERSONAL_WHATSAPP unset — using default ops target ${OPS_ALERT_TARGET_DIGITS}`);
  return OPS_ALERT_TARGET_DIGITS;
}

export async function sendOpsAlert(
  args: OpsAlertArgs,
  deps: OpsAlertDeps = {},
): Promise<OpsAlertResult> {
  const sendTemplate = deps.sendTemplate ?? sendTemplateMessage;
  const writeAuditFn = deps.writeAuditFn ?? writeAudit;
  const setWamid = deps.setEscalationWamid ?? setEscalationProviderMessageId;
  const env = deps.env ?? process.env;

  const bodyParams = [
    orDash(args.patientName, "unknown"),
    orDash(args.patientAge),
    orDash(args.serviceDisplay),
    orDash(args.location),
    orDash(args.context),
    orDash(args.patientMobile, "unknown"),
  ];

  const primary = primaryTarget(env);
  // primary, primary-retry, then the alternate number.
  const targets: string[] = [primary, primary, OPS_ALERT_ALT_DIGITS];

  let attempts = 0;
  for (const target of targets) {
    attempts++;
    let providerMessageId: string | undefined;
    try {
      // ONLY the send itself triggers a retry. A side-effect failure below
      // (wamid stamp / audit) must NOT cause a resend — the message already went.
      ({ providerMessageId } = await sendTemplate({
        to: target,
        templateName: LEAD_ALERT_TEMPLATE,
        bodyParams,
        quickReplyPayload: args.escalationId ?? undefined,
      }));
    } catch (err) {
      log.error(`ops alert send failed (attempt ${attempts} → ${target})`, err);
      continue;
    }

    if (args.escalationId && providerMessageId) {
      try {
        await setWamid(args.escalationId, providerMessageId);
      } catch (err) {
        log.error("ops alert: wamid stamp failed (non-fatal)", err);
      }
    }
    await writeAuditFn({
      conversationId: args.conversationId,
      eventType: AuditEvent.OPS_ALERT_SENT,
      eventData: {
        escalation_id: args.escalationId,
        wamid: providerMessageId ?? null,
        target_phone: target,
        attempt: attempts,
      },
    });
    return { sent: true, providerMessageId, target, attempts };
  }

  // Every attempt failed — make it LOUD, never silent.
  await writeAuditFn({
    conversationId: args.conversationId,
    eventType: AuditEvent.OPS_ALERT_FAILED,
    eventData: {
      escalation_id: args.escalationId,
      attempts,
      tried: [primary, OPS_ALERT_ALT_DIGITS],
    },
  });
  return { sent: false, attempts };
}
