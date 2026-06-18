// Pluggable OTP delivery. Channels are independent and each implementation
// is self-contained — wiring a new provider does not require touching the
// other providers, the API routes, or the BookingGate UI.
//
// The dispatcher picks a channel:
//   - 'whatsapp' (default):  WhatsApp Cloud API direct — lib/otp/whatsapp.ts
//   - 'sms'      (fallback): MSG91 — lib/otp/msg91.ts
//
// Each channel is independently flagged via its own *_OTP_ENABLED env var so
// primary/secondary can be flipped without code changes.
//
// Errors thrown here surface to the /api/auth/send-otp caller as a 502
// (delivery failed) so the UI can show "We couldn't send the code; please
// try again or use SMS instead."

import { sendWhatsAppOtp } from "./whatsapp";
import { sendSmsOtp } from "./msg91";

export type OtpChannel = "whatsapp" | "sms";

export interface SendOtpInput {
  /** E.164-normalised phone, e.g. "+919711977782". */
  phone: string;
  /** The 6-digit plaintext OTP. The sender substitutes it into the template. */
  code: string;
  channel: OtpChannel;
}

export interface SendOtpResult {
  /** Provider's message ID, for tracing in logs. */
  providerMessageId?: string;
}

export class OtpDeliveryError extends Error {
  constructor(
    message: string,
    public readonly channel: OtpChannel,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OtpDeliveryError";
  }
}

/**
 * Dispatch a single OTP. Throws OtpDeliveryError on any provider-side failure;
 * callers should treat that as "delivery failed, keep the user on the entry
 * screen with an error" — the OTP row in Supabase should still be considered
 * issued so cooldown windows still apply (prevents send-spam via retry).
 */
export async function sendOtp(input: SendOtpInput): Promise<SendOtpResult> {
  switch (input.channel) {
    case "whatsapp":
      return sendWhatsAppOtp(input);
    case "sms": {
      const enabled = process.env.SMS_OTP_ENABLED === "true";
      if (!enabled) {
        throw new OtpDeliveryError(
          "SMS OTP is not enabled in this environment.",
          "sms",
        );
      }
      return sendSmsOtp(input);
    }
  }
}
