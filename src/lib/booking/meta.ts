// T-Prong-B C1 — Meta-direct successor to src/lib/booking/rampwin.ts.
// Sends `aarogya_lead_alert` to ops via sendTemplateMessage (WhatsApp
// Cloud API direct, no BSP).
//
// Behavioral contract preserved from the Rampwin original:
//   - Best-effort: NEVER throws on the caller. Errors logged via
//     console.error and swallowed so the booking response stays
//     authoritative.
//   - Returns { delivered: boolean }.
//   - Disabled-by-flag short-circuits with a log line and returns
//     { delivered: false }.
//
// Env vars:
//   WHATSAPP_LEAD_ALERT_ENABLED — must be exact "true" to send. Default
//     off so a missing/empty env value is a hard off (matches Prong A
//     WHATSAPP_OTP_ENABLED pattern).
//   WHATSAPP_OPS_PHONE — recipient ops phone in digits-only
//                        "91XXXXXXXXXX" form. REQUIRED when ENABLED.
//   WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_API_VERSION
//     — shared with sendTemplateMessage; validated there.
//
// Template name is a code constant (no env override). {{1}}..{{6}} body
// var contract byte-identical to the Rampwin original — aarogya_lead_alert
// {{5}} Context format from src/lib/booking/contextFormat.ts MUST stay
// stable per CLAUDE.md.

import { sendTemplateMessage } from "@/lib/whatsapp/cloud-api";

const TEMPLATE_NAME = "aarogya_lead_alert";

export interface AarogyaLeadAlertInput {
  /** Patient name as captured in Step 1 (or pulled from the verified session). */
  patientName: string;
  /**
   * Age + "y" string. Defaults to literal "—y" if not supplied.
   */
  ageWithYearSuffix?: string;
  /** Service display name from t85ServiceDisplayName(). */
  serviceDisplayName: string;
  /** Formatted address. Single line, no newlines. */
  location: string;
  /** Optional notes/symptoms text. Defaults to "—" if empty. */
  context?: string;
  /** Patient mobile in +91 form, e.g. "+919711977782". */
  patientPhone: string;
}

export async function sendAarogyaLeadAlert(
  input: AarogyaLeadAlertInput,
): Promise<{ delivered: boolean }> {
  const enabled = process.env.WHATSAPP_LEAD_ALERT_ENABLED === "true";
  if (!enabled) {
    // Explicit log so disabled state is visible in Netlify Functions
    // logs — same posture as the Rampwin original (silent disable made
    // the 2026-06-08 silent-failure incident impossible to debug).
    console.log(
      "[aarogya_lead_alert] disabled via WHATSAPP_LEAD_ALERT_ENABLED!=true",
    );
    return { delivered: false };
  }

  console.log("[aarogya_lead_alert] dispatch start");

  try {
    const opsPhone = process.env.WHATSAPP_OPS_PHONE;
    if (!opsPhone) {
      console.error(
        "[aarogya_lead_alert] missing env var WHATSAPP_OPS_PHONE",
      );
      return { delivered: false };
    }
    const opsPhoneDigits = opsPhone.replace(/\D/g, "");
    if (!/^91\d{10}$/.test(opsPhoneDigits)) {
      console.error(
        `[aarogya_lead_alert] WHATSAPP_OPS_PHONE has unexpected format: ${opsPhone}`,
      );
      return { delivered: false };
    }

    // Patient phone normalised to "+91XXXXXXXXXX" display form for {{6}}.
    const patientDigits = input.patientPhone.replace(/\D/g, "");
    const patientDisplay = patientDigits.startsWith("91")
      ? `+${patientDigits}`
      : `+91${patientDigits}`;

    await sendTemplateMessage({
      to: opsPhoneDigits,
      templateName: TEMPLATE_NAME,
      bodyParams: [
        input.patientName.trim() || "—",
        input.ageWithYearSuffix?.trim() || "—y",
        input.serviceDisplayName.trim(),
        input.location.trim() || "—",
        input.context?.trim() || "—",
        patientDisplay,
      ],
    });

    return { delivered: true };
  } catch (cause) {
    // Defensive catch — sendTemplateMessage throws CloudApiError on
    // network / API failure. Booking integrity wins; we log and return.
    console.error("[aarogya_lead_alert] send failed", cause);
    return { delivered: false };
  }
}
