// WhatsApp Cloud API — Authentication template message.
//
// Requires three env vars (set in Netlify):
//   WHATSAPP_PHONE_NUMBER_ID    — from developers.facebook.com → app →
//                                 WhatsApp → API Setup → "Phone number ID".
//                                 NOT the same as Business Suite's "Phone
//                                 profile ID"; double-check before pasting.
//   WHATSAPP_ACCESS_TOKEN       — never-expire System User token with
//                                 whatsapp_business_messaging +
//                                 whatsapp_business_management permissions.
//   WHATSAPP_OTP_TEMPLATE_NAME  — defaults to "sanocare_otp". Must be an
//                                 APPROVED Authentication-category template
//                                 in WhatsApp Manager with body parameter
//                                 {{1}} for the code and an url-button-with-
//                                 parameter for "Copy code".
//   WHATSAPP_API_VERSION        — defaults to "v21.0".

import type { SendOtpInput, SendOtpResult } from "./sender";
import { OtpDeliveryError } from "./sender";

const GRAPH_BASE = "https://graph.facebook.com";

interface MetaMessagesResponse {
  messaging_product?: string;
  contacts?: { input: string; wa_id: string }[];
  messages?: { id: string }[];
  error?: {
    message: string;
    type: string;
    code: number;
    error_data?: { details: string };
  };
}

export async function sendWhatsAppOtp(
  input: SendOtpInput,
): Promise<SendOtpResult> {
  const phoneNumberId = requireEnv("WHATSAPP_PHONE_NUMBER_ID");
  const accessToken = requireEnv("WHATSAPP_ACCESS_TOKEN");
  const templateName = process.env.WHATSAPP_OTP_TEMPLATE_NAME ?? "sanocare_otp";
  const apiVersion = process.env.WHATSAPP_API_VERSION ?? "v21.0";

  // The "to" field on Graph wants the digits-only E.164 form, no plus sign.
  const to = input.phone.replace(/[^\d]/g, "");

  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: "en" },
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: input.code }],
        },
        {
          // The Authentication category template's "Copy code" button is an
          // url-type button at index 0 — the parameter is the code itself,
          // not a URL. (This is the documented shape for OTP templates.)
          type: "button",
          sub_type: "url",
          index: 0,
          parameters: [{ type: "text", text: input.code }],
        },
      ],
    },
  };

  let response: Response;
  try {
    response = await fetch(`${GRAPH_BASE}/${apiVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new OtpDeliveryError(
      "Network error reaching WhatsApp Cloud API.",
      "whatsapp",
      cause,
    );
  }

  const json = (await response.json().catch(() => ({}))) as MetaMessagesResponse;
  if (!response.ok || json.error) {
    const detail = json.error?.error_data?.details ?? json.error?.message;
    throw new OtpDeliveryError(
      `WhatsApp send failed (${response.status}): ${detail ?? "unknown"}`,
      "whatsapp",
      json.error,
    );
  }

  return { providerMessageId: json.messages?.[0]?.id };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new OtpDeliveryError(
      `Missing required env var: ${name}.`,
      "whatsapp",
    );
  }
  return value;
}
