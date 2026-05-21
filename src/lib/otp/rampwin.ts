// Rampwin — WhatsApp OTP via a third-party BSP gateway.
//
// API: POST https://api.rampwin.com/api/messages/send?dontShowInChatList=false
//   headers: { 'X-API-Key': RAMPWIN_API_KEY, 'Content-Type': 'application/json' }
//   body:    { channel_id, phone_number, hide_from_chat, template }
//
// `phone_number` is "91XXXXXXXXXX" (digits-only, country code prefix, no `+`).
// `template` is the AUTHENTICATION-category template registered with Rampwin
// (default `sanocare_otp`). The OTP code goes into both the body parameter
// and the url-button parameter — same shape as Meta Cloud's WhatsApp
// templates, so the message renders the same way in the patient's client.
//
// Success response shape (per the gateway's confirmed live test):
//   { success: true, data: { messageId: "..." } }
// Anything else — non-2xx, missing `success === true`, or network error —
// is surfaced as an OtpDeliveryError so /api/auth/send-otp returns 502.
//
// Required Netlify env vars (set when ready to flip primary to Rampwin):
//   RAMPWIN_API_KEY            — secret, from Rampwin dashboard
//   RAMPWIN_CHANNEL_ID         — channel id Rampwin issues per WhatsApp
//                                phone number (e.g. 69f4772f10198a2eb3cda6f2)
//
// Optional env vars (defaults shown):
//   RAMPWIN_API_URL            — full POST URL incl. query string;
//                                defaults to the documented endpoint
//   RAMPWIN_OTP_TEMPLATE_NAME  — defaults to 'sanocare_otp'

import type { SendOtpInput, SendOtpResult } from "./sender";
import { OtpDeliveryError } from "./sender";

const DEFAULT_API_URL =
  "https://api.rampwin.com/api/messages/send?dontShowInChatList=false";

interface RampwinResponse {
  success?: boolean;
  data?: { messageId?: string };
  // The gateway is unspecified on its error shape — we surface whatever
  // the response carries. Common fields below are best-effort.
  message?: string;
  error?: string | { message?: string };
}

export async function sendRampwinOtp(
  input: SendOtpInput,
): Promise<SendOtpResult> {
  const apiKey = requireEnv("RAMPWIN_API_KEY");
  const channelId = requireEnv("RAMPWIN_CHANNEL_ID");
  const apiUrl = process.env.RAMPWIN_API_URL?.trim() || DEFAULT_API_URL;
  const templateName =
    process.env.RAMPWIN_OTP_TEMPLATE_NAME?.trim() || "sanocare_otp";

  // Rampwin expects "91XXXXXXXXXX" (12 digits, country code prefix).
  // input.phone arrives normalised as "+91XXXXXXXXXX" — strip the +.
  const phoneNumber = input.phone.replace(/\D/g, "");
  if (!/^91\d{10}$/.test(phoneNumber)) {
    throw new OtpDeliveryError(
      `Rampwin received an unexpected phone format: ${input.phone}`,
      "rampwin",
    );
  }

  const body = {
    channel_id: channelId,
    phone_number: phoneNumber,
    hide_from_chat: false,
    template: {
      name: templateName,
      // Rampwin's policy field is "deterministic" — render in `code`'s
      // language without server-side fallback negotiation.
      language: { policy: "deterministic", code: "en" },
      category: "AUTHENTICATION",
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: input.code }],
        },
        {
          // The AUTHENTICATION template's "Copy code" button is a url-type
          // button at index "0" (string, per Rampwin's wire shape — Meta
          // Cloud uses a number here). The parameter is the code itself.
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: input.code }],
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
    throw new OtpDeliveryError(
      "Network error reaching Rampwin.",
      "rampwin",
      cause,
    );
  }

  const json = (await response.json().catch(() => ({}))) as RampwinResponse;

  if (!response.ok || json.success !== true) {
    const detail =
      typeof json.error === "string"
        ? json.error
        : json.error?.message ?? json.message ?? "unknown";
    throw new OtpDeliveryError(
      `Rampwin send failed (HTTP ${response.status}): ${detail}`,
      "rampwin",
      json,
    );
  }

  return { providerMessageId: json.data?.messageId };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new OtpDeliveryError(
      `Missing required env var: ${name}.`,
      "rampwin",
    );
  }
  return value;
}
