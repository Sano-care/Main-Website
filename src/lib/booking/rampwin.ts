// T85 PR4a — `aarogya_lead_alert` WhatsApp template send via Rampwin BSP.
//
// Triggered on successful /api/razorpay/verify in PR4a. Mirrors the
// existing OTP / consult-join / Rx Rampwin senders (lib/otp/rampwin.ts,
// lib/consult/rampwin.ts, lib/rx/rampwin.ts) for wire consistency.
//
// ──────────────────────────────────────────────────────────────────────
// IMPORTANT — production has NEVER sent this template before T85.
//
// PR4a recon (2026-06-07) confirmed:
//   - `aarogya_lead_alert` is approved on Meta WhatsApp Manager
//   - The template is APPROVED in the Rampwin BSP catalog
//   - BUT no production code path has ever called it
//   - Brief originally framed this as "preserve existing trigger" — that
//     framing is wrong. PR4a BUILDS the alert from scratch.
// ──────────────────────────────────────────────────────────────────────
//
// Template payload (6 body variables — UTILITY category, no buttons):
//   {{1}} Patient name
//   {{2}} Age + "y" (e.g., "45 y")  — PLACEHOLDER "—y" until T64 ships
//                                     age collection in Step 1. Ops
//                                     accepts this as the launch state
//                                     per founder Q1.
//   {{3}} Service display name (Home-Visit | Teleconsultation |
//                               Lab Tests at Home | Medic at Home)
//   {{4}} Location (formatted address)
//   {{5}} Context (notes/symptoms; "—" default)
//   {{6}} Mobile (+91 ten-digit form)
//
// Best-effort delivery: this function NEVER throws on the caller. Errors
// are logged via console.error and swallowed so the booking response
// stays authoritative. The booking row is the source of truth; the
// alert is convenience for ops.
//
// Env vars (defaults shown):
//   RAMPWIN_LEAD_ALERT_ENABLED       — "true" (PR4a default in prod env)
//   RAMPWIN_LEAD_ALERT_TEMPLATE_NAME — "aarogya_lead_alert"
//   RAMPWIN_OPS_PHONE                — recipient ops phone (E.164 w/o "+",
//                                      e.g. "919711977782"). REQUIRED
//                                      when ENABLED is true.
//   RAMPWIN_API_URL, RAMPWIN_API_KEY, RAMPWIN_CHANNEL_ID — same as
//   `lib/otp/rampwin.ts`. Shared infra; one BSP account.

const DEFAULT_API_URL =
  "https://api.rampwin.com/api/messages/send?dontShowInChatList=false";
const DEFAULT_TEMPLATE_NAME = "aarogya_lead_alert";

export interface AarogyaLeadAlertInput {
  /** Patient name as captured in Step 1 (or pulled from the verified session). */
  patientName: string;
  /**
   * Age + "y" string. Defaults to the literal "—y" until T64 ships the
   * family-member-picker that collects age. Callers may override but
   * the default exists so PR4a doesn't have to thread age through every
   * step component.
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

interface RampwinResponse {
  success?: boolean;
  data?: { messageId?: string };
  message?: string;
  error?: string | { message?: string };
}

/**
 * Fire the lead alert to ops. Returns `{ delivered: boolean }`; never
 * throws. When the env flag is off or the recipient isn't configured,
 * the function no-ops and returns `{ delivered: false }`.
 */
export async function sendAarogyaLeadAlert(
  input: AarogyaLeadAlertInput,
): Promise<{ delivered: boolean }> {
  const enabled = process.env.RAMPWIN_LEAD_ALERT_ENABLED !== "false";
  if (!enabled) {
    // Explicit log so disabled state is visible in Netlify Functions
    // logs — previously silent, which made debugging impossible during
    // the 2026-06-08 silent-failure incident (Case #SAN-B-00058).
    console.log(
      "[aarogya_lead_alert] disabled via RAMPWIN_LEAD_ALERT_ENABLED=false",
    );
    return { delivered: false };
  }

  // Entry log — confirms the function was reached at all. Critical for
  // distinguishing "call site never invoked sender" (e.g. fire-and-
  // forget eaten by serverless teardown) from "sender ran but BSP
  // rejected payload."
  console.log("[aarogya_lead_alert] dispatch start");

  try {
    const apiKey = process.env.RAMPWIN_API_KEY;
    const channelId = process.env.RAMPWIN_CHANNEL_ID;
    const opsPhone = process.env.RAMPWIN_OPS_PHONE;
    if (!apiKey || !channelId || !opsPhone) {
      console.error(
        "[aarogya_lead_alert] missing env vars — required: RAMPWIN_API_KEY, RAMPWIN_CHANNEL_ID, RAMPWIN_OPS_PHONE",
      );
      return { delivered: false };
    }

    const apiUrl = process.env.RAMPWIN_API_URL?.trim() || DEFAULT_API_URL;
    const templateName =
      process.env.RAMPWIN_LEAD_ALERT_TEMPLATE_NAME?.trim() ||
      DEFAULT_TEMPLATE_NAME;

    // Ops phone normalised to digits-only "91XXXXXXXXXX" form.
    const opsPhoneDigits = opsPhone.replace(/\D/g, "");
    if (!/^91\d{10}$/.test(opsPhoneDigits)) {
      console.error(
        `[aarogya_lead_alert] RAMPWIN_OPS_PHONE has unexpected format: ${opsPhone}`,
      );
      return { delivered: false };
    }

    // Patient phone normalised to "+91XXXXXXXXXX" display form for {{6}}.
    const patientDigits = input.patientPhone.replace(/\D/g, "");
    const patientDisplay = patientDigits.startsWith("91")
      ? `+${patientDigits}`
      : `+91${patientDigits}`;

    const body = {
      channel_id: channelId,
      phone_number: opsPhoneDigits,
      hide_from_chat: false,
      template: {
        name: templateName,
        language: { policy: "deterministic", code: "en" },
        category: "UTILITY",
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: input.patientName.trim() || "—" },
              { type: "text", text: input.ageWithYearSuffix?.trim() || "—y" },
              { type: "text", text: input.serviceDisplayName.trim() },
              { type: "text", text: input.location.trim() || "—" },
              { type: "text", text: input.context?.trim() || "—" },
              { type: "text", text: patientDisplay },
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
      console.error(
        "[aarogya_lead_alert] network error reaching Rampwin",
        cause,
      );
      return { delivered: false };
    }

    const json = (await response.json().catch(() => ({}))) as RampwinResponse;

    if (!response.ok || json.success !== true) {
      const detail =
        typeof json.error === "string"
          ? json.error
          : json.error?.message ?? json.message ?? "unknown";
      console.error(
        `[aarogya_lead_alert] Rampwin send failed (HTTP ${response.status}): ${detail}`,
      );
      return { delivered: false };
    }

    return { delivered: true };
  } catch (cause) {
    // Defensive catch — anything else we missed gets logged but doesn't
    // bubble up to the caller. Booking integrity wins.
    console.error("[aarogya_lead_alert] unexpected failure", cause);
    return { delivered: false };
  }
}
