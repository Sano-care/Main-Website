// MSG91 SMS OTP — primary channel while the WhatsApp WABA restriction
// is being resolved.
//
// API: POST https://control.msg91.com/api/v5/otp
//   headers: { authkey: MSG91_AUTH_KEY, content-type: application/json }
//   body:    { template_id, mobile, otp }
//
// `mobile` is the digits-only E.164 form (no `+`). MSG91 substitutes our
// 6-digit `otp` into the {{otp}} placeholder of the DLT-registered template
// identified by `template_id`. The sender ID is baked into the template at
// registration time; not passed per request.
//
// Required Netlify env vars (set when DLT clears):
//   MSG91_AUTH_KEY         — secret, from MSG91 dashboard → API → Auth Key
//   MSG91_OTP_TEMPLATE_ID  — the DLT-approved OTP template ID for the
//                            "Sanocare" sender ID
//   MSG91_SENDER_ID        — kept for reference / future DLT compliance
//                            checks; the template itself enforces sender
//
// Returns the MSG91 request_id as providerMessageId for log tracing.

import type { SendOtpInput, SendOtpResult } from "./sender";
import { OtpDeliveryError } from "./sender";

const MSG91_ENDPOINT = "https://control.msg91.com/api/v5/otp";

interface Msg91Response {
  type?: "success" | "error";
  request_id?: string;
  message?: string | { description?: string };
}

export async function sendSmsOtp(input: SendOtpInput): Promise<SendOtpResult> {
  const authKey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_OTP_TEMPLATE_ID;
  if (!authKey || !templateId) {
    throw new OtpDeliveryError(
      "MSG91 credentials are not configured. Set MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID in Netlify env, then redeploy.",
      "sms",
    );
  }

  // MSG91 expects digits-only E.164 (e.g. "919711977782"). The phone here
  // arrives as "+91XXXXXXXXXX" — strip the +.
  const mobile = input.phone.replace(/\D/g, "");
  if (mobile.length !== 12 || !mobile.startsWith("91")) {
    throw new OtpDeliveryError(
      `MSG91 received an unexpected phone format: ${input.phone}`,
      "sms",
    );
  }

  let response: Response;
  try {
    response = await fetch(MSG91_ENDPOINT, {
      method: "POST",
      headers: {
        authkey: authKey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        template_id: templateId,
        mobile,
        otp: input.code,
      }),
    });
  } catch (cause) {
    throw new OtpDeliveryError(
      "Network error reaching MSG91.",
      "sms",
      cause,
    );
  }

  const json = (await response.json().catch(() => ({}))) as Msg91Response;

  if (!response.ok || json.type !== "success") {
    // MSG91 surfaces `message` either as a string or as an object with a
    // `description` field depending on the error class.
    const detail =
      typeof json.message === "string"
        ? json.message
        : json.message?.description ?? "unknown";
    throw new OtpDeliveryError(
      `MSG91 send failed (HTTP ${response.status}): ${detail}`,
      "sms",
      json,
    );
  }

  return { providerMessageId: json.request_id };
}
