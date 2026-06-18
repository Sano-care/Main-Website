// T-Prong-B C4 (shell, signatures only) — Meta-direct successor to
// src/lib/consult/rampwin.ts. Single template (sanocare_consult_join).
//
// Throws MetaConsultDeliveryError on failure — call site at
// ops/(shell)/bookings/actions.ts:1327 uses a plain try/catch (no
// instanceof check), so rename from RampwinConsultDeliveryError is
// safe + cleaner.
//
// Env vars:
//   WHATSAPP_CONSULT_ENABLED — "true" to allow sends
//   NEXT_PUBLIC_SITE_URL     — default "https://sanocare.in"; used to
//                              build the join URL placed in body {{3}}.
//
// Template name is a code constant (no env override).

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
 *   {{3}} `${siteUrl}/c/${joinToken}` — full URL renders inline as
 *         tappable link (template has NO URL button; URL sits in body)
 *
 * Throws MetaConsultDeliveryError on:
 *   - WHATSAPP_CONSULT_ENABLED not "true"
 *   - Phone not in "91XXXXXXXXXX" form after normalize
 *   - Meta Cloud API failure
 */
export async function sendConsultJoinLink(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- shell only
  input: SendConsultJoinLinkInput,
): Promise<SendConsultJoinLinkResult> {
  throw new MetaConsultDeliveryError(
    "sendConsultJoinLink: implementation lands in C4",
  );
}
