// T-Prong-B C4 — Meta-direct successor to src/lib/consult/rampwin.ts.
// Single template (sanocare_consult_join).
//
// Throws MetaConsultDeliveryError on failure — call site at
// ops/(shell)/bookings/actions.ts uses a plain try/catch (no
// instanceof check), so the rename from RampwinConsultDeliveryError
// is safe + cleaner.
//
// Env vars:
//   WHATSAPP_CONSULT_ENABLED — "true" to allow sends
//   NEXT_PUBLIC_SITE_URL     — default "https://sanocare.in"; used to
//                              build the join URL placed in body {{3}}.
//
// Template name is a code constant (no env override).

import {
  sendTemplateMessage,
  CloudApiError,
} from "@/lib/whatsapp/cloud-api";

const TEMPLATE_NAME = "sanocare_consult_join";
const DEFAULT_SITE_URL = "https://sanocare.in";

export class MetaConsultDeliveryError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "MetaConsultDeliveryError";
  }
}

export interface SendConsultJoinLinkInput {
  /** E.164-normalised phone, e.g. "+919711977782". */
  phone: string;
  /** The 32-hex join token — substituted into the full URL placed in body {{3}}. */
  joinToken: string;
  /** Patient's full display name for the message body ({{1}}). */
  patientName: string;
  /** Doctor's full display name for the message body ({{2}}). */
  doctorName: string;
}

export interface SendConsultJoinLinkResult {
  providerMessageId?: string;
}

/**
 * Send the patient a teleconsultation join link via WhatsApp Cloud API.
 *
 * Template: sanocare_consult_join (UTILITY, en).
 * BODY VARS (positional, 3):
 *   {{1}} patientName
 *   {{2}} doctorName
 *   {{3}} `${siteUrl}/c/${joinToken}` — full URL renders inline as a
 *         tappable link (template has NO URL button; URL sits in body).
 */
export async function sendConsultJoinLink(
  input: SendConsultJoinLinkInput,
): Promise<SendConsultJoinLinkResult> {
  if (process.env.WHATSAPP_CONSULT_ENABLED !== "true") {
    throw new MetaConsultDeliveryError(
      "WhatsApp consult send disabled — WHATSAPP_CONSULT_ENABLED must be \"true\".",
    );
  }

  const phoneNumber = input.phone.replace(/\D/g, "");
  if (!/^91\d{10}$/.test(phoneNumber)) {
    throw new MetaConsultDeliveryError(
      `Unexpected phone format: ${input.phone}`,
    );
  }

  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || DEFAULT_SITE_URL
  ).replace(/\/+$/, "");
  const joinUrl = `${siteUrl}/c/${input.joinToken}`;

  try {
    const result = await sendTemplateMessage({
      to: phoneNumber,
      templateName: TEMPLATE_NAME,
      bodyParams: [input.patientName, input.doctorName, joinUrl],
    });
    return { providerMessageId: result.providerMessageId };
  } catch (cause) {
    if (cause instanceof CloudApiError) {
      throw new MetaConsultDeliveryError(
        `Meta Cloud API rejected consult-join send: ${cause.message}`,
        cause,
      );
    }
    throw new MetaConsultDeliveryError(
      "Unexpected consult-join send failure",
      cause,
    );
  }
}
