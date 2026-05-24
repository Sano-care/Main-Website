// Rampwin WhatsApp sender for the consultation join-link delivery.
//
// Parallel module to src/lib/otp/rampwin.ts. Same API endpoint and
// transport, different template — the OTP template
// (`sanocare_otp`, AUTHENTICATION category) is approved for one-time
// codes only and cannot carry a consult-join link.
//
// Template provisioning is a founder/BSP task (separate from Zoom task
// #88): a new Rampwin WhatsApp template must be registered with
// Rampwin and approved by Meta before this code can deliver live. The
// template name is configurable via the
// RAMPWIN_CONSULT_TEMPLATE_NAME env var (default
// `sanocare_consult_join`). Expected parameter contract is documented
// inline below — the founder configures Rampwin to match.
//
// Until the template is approved, this code BUILDS fine but live
// sends throw RampwinConsultDeliveryError. The ops booking flow
// catches the throw, persists the booking + session + token regardless,
// and surfaces a "WhatsApp delivery failed — copy this link" fallback
// in /ops/bookings/[id] so ops can deliver the link out-of-band.
//
// Required env vars (already set; same as OTP path):
//   RAMPWIN_API_KEY            — secret
//   RAMPWIN_CHANNEL_ID         — channel id
// Optional env vars:
//   RAMPWIN_API_URL                  — full POST URL (defaults to the
//                                       documented endpoint)
//   RAMPWIN_CONSULT_TEMPLATE_NAME    — default 'sanocare_consult_join'
//   RAMPWIN_CONSULT_TEMPLATE_LANG    — default 'en'
//   NEXT_PUBLIC_SITE_URL             — default 'https://sanocare.in';
//                                       used to build the join URL that
//                                       goes into the message body.

const DEFAULT_API_URL =
  "https://api.rampwin.com/api/messages/send?dontShowInChatList=false";
const DEFAULT_SITE_URL = "https://sanocare.in";

export class RampwinConsultDeliveryError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "RampwinConsultDeliveryError";
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

interface RampwinResponse {
  success?: boolean;
  data?: { messageId?: string };
  message?: string;
  error?: string | { message?: string };
}

/**
 * Send the patient a teleconsultation join link via Rampwin WhatsApp.
 *
 * Expected template (founder/BSP responsibility — configure to match):
 *   name:     RAMPWIN_CONSULT_TEMPLATE_NAME (default 'sanocare_consult_join')
 *   category: 'UTILITY'
 *   body parameters (positional, three vars):
 *     {{1}} patient full name (e.g. "Anjali Sharma")
 *     {{2}} doctor full name  (e.g. "Dr Ravi Kapoor")
 *     {{3}} full join URL     (e.g. "https://sanocare.in/c/<token>")
 *   NO URL button — the full URL sits in the body so WhatsApp renders
 *   it as a tappable link inline.
 *
 * The fetch shape here mirrors src/lib/otp/rampwin.ts exactly — only
 * the components array differs.
 */
export async function sendConsultJoinLink(
  input: SendConsultJoinLinkInput,
): Promise<SendConsultJoinLinkResult> {
  const apiKey = requireEnv("RAMPWIN_API_KEY");
  const channelId = requireEnv("RAMPWIN_CHANNEL_ID");
  const apiUrl = process.env.RAMPWIN_API_URL?.trim() || DEFAULT_API_URL;
  const templateName =
    process.env.RAMPWIN_CONSULT_TEMPLATE_NAME?.trim() || "sanocare_consult_join";
  const templateLang =
    process.env.RAMPWIN_CONSULT_TEMPLATE_LANG?.trim() || "en";

  // Build the full join URL the BSP template carries inline as {{3}}.
  // Defensive trailing-slash strip so SITE_URL ending with "/" doesn't
  // produce //c/<token>.
  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || DEFAULT_SITE_URL
  ).replace(/\/+$/, "");
  const joinUrl = `${siteUrl}/c/${input.joinToken}`;

  // Rampwin expects "91XXXXXXXXXX" (12 digits, country-code prefix, no `+`).
  const phoneNumber = input.phone.replace(/\D/g, "");
  if (!/^91\d{10}$/.test(phoneNumber)) {
    throw new RampwinConsultDeliveryError(
      `Rampwin received an unexpected phone format: ${input.phone}`,
    );
  }

  const body = {
    channel_id: channelId,
    phone_number: phoneNumber,
    hide_from_chat: false,
    template: {
      name: templateName,
      language: { policy: "deterministic", code: templateLang },
      category: "UTILITY",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: input.patientName },
            { type: "text", text: input.doctorName },
            { type: "text", text: joinUrl },
          ],
        },
      ],
    },
  };

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new RampwinConsultDeliveryError(
      "Network error reaching Rampwin.",
      cause,
    );
  }

  const json = (await response.json().catch(() => ({}))) as RampwinResponse;
  if (!response.ok || json.success !== true) {
    const detail =
      typeof json.error === "string"
        ? json.error
        : json.error?.message ?? json.message ?? "unknown";
    throw new RampwinConsultDeliveryError(
      `Rampwin send failed (HTTP ${response.status}): ${detail}`,
      json,
    );
  }

  return { providerMessageId: json.data?.messageId };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new RampwinConsultDeliveryError(`Missing required env var: ${name}.`);
  }
  return v;
}
