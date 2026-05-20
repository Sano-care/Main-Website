// MSG91 SMS OTP — STUB.
//
// Pluggable but not wired yet. The dispatcher in lib/otp/sender.ts will only
// route here when:
//   1. The caller explicitly passes channel: 'sms', AND
//   2. SMS_OTP_ENABLED=true is set in Netlify env
//
// The BookingGate UI keeps the "Send via SMS instead" link hidden behind
// the same SMS_OTP_ENABLED flag, so until both pieces are flipped the WhatsApp
// path is the only thing patients can hit.
//
// When Shashwat provides MSG91 credentials, replace the throw block below
// with the real call. Recommended:
//   POST https://control.msg91.com/api/v5/otp
//   headers: { authkey: MSG91_AUTH_KEY }
//   body: { template_id, mobile, otp, sender }
// MSG91's OTP API will substitute {{otp}} into your approved template.

import type { SendOtpInput, SendOtpResult } from "./sender";
import { OtpDeliveryError } from "./sender";

export async function sendSmsOtp(input: SendOtpInput): Promise<SendOtpResult> {
  const authKey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_OTP_TEMPLATE_ID;
  if (!authKey || !templateId) {
    throw new OtpDeliveryError(
      "MSG91 credentials are not configured. Set MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID, then flip SMS_OTP_ENABLED=true.",
      "sms",
    );
  }

  // === IMPLEMENTATION PLACEHOLDER ===
  // const response = await fetch("https://control.msg91.com/api/v5/otp", { ... });
  // Parse + return providerMessageId. Throw OtpDeliveryError on failure.
  // ==================================
  void input;
  throw new OtpDeliveryError(
    "MSG91 SMS sender is not implemented yet.",
    "sms",
  );
}
