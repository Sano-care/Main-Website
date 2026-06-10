// Aarogya Slice 2a — patient-facing WhatsApp template senders via the
// Rampwin BSP. Three approved Meta templates, fired from existing booking
// + ops flows:
//
//   sendBookingConfirmed       — sanocare_booking_confirmed (4 vars)
//   sendVisitComplete          — aarogya_visit_complete (2 vars + 3 QR buttons)
//   sendLabCollectionScheduled — sanocare_lab_collection_scheduled (4 vars)
//
// Wire shape, env, and failure posture mirror `lib/booking/rampwin.ts`
// (sendAarogyaLeadAlert) and `lib/otp/rampwin.ts`: shared RAMPWIN_API_KEY /
// RAMPWIN_CHANNEL_ID / RAMPWIN_API_URL, deterministic en template language,
// UTILITY category, body-parameter array. Every sender is best-effort —
// it AWAITS the BSP call (Netlify Functions freeze on response, so
// fire-and-forget never executes — see razorpay/verify for the incident
// note) but NEVER throws on the caller. The booking row is the source of
// truth; the WhatsApp message is convenience.
//
// Unlike sendAarogyaLeadAlert (which targets the ops phone), these three
// target the PATIENT (bookings.phone).
//
// Per-template env overrides (all optional; sensible defaults shown):
//   RAMPWIN_BOOKING_CONFIRMED_ENABLED / _TEMPLATE_NAME
//   RAMPWIN_VISIT_COMPLETE_ENABLED    / _TEMPLATE_NAME
//   RAMPWIN_LAB_COLLECTION_ENABLED    / _TEMPLATE_NAME

import type { ServiceSlug } from "@/lib/services/catalog";
import {
  firstName,
  getBookingLabel,
  getBookingNextStep,
  getServiceLabel,
} from "@/lib/aarogya/labels";

const DEFAULT_API_URL =
  "https://api.rampwin.com/api/messages/send?dontShowInChatList=false";

interface RampwinResponse {
  success?: boolean;
  data?: { messageId?: string };
  message?: string;
  error?: string | { message?: string };
}

interface DispatchInput {
  /** Short tag for log lines, e.g. "sanocare_booking_confirmed". */
  logTag: string;
  /** Resolved template name (after env override). */
  templateName: string;
  /** Patient phone in any format; normalized to "91XXXXXXXXXX" here. */
  patientPhone: string;
  /** Ordered body variables {{1}}..{{n}}. */
  bodyParams: string[];
}

/**
 * Internal: POST a body-only template to the patient via Rampwin. Returns
 * `{ delivered }`; never throws. Quick-reply buttons defined on the
 * approved template (e.g. aarogya_visit_complete) are STATIC — Meta does
 * not require a `button` component in the send payload for them, so a
 * body-only parameter array is correct.
 */
async function dispatchTemplate(
  input: DispatchInput,
): Promise<{ delivered: boolean }> {
  // Entry log — distinguishes "call site never invoked sender" from
  // "sender ran but BSP rejected payload" in Netlify Functions logs.
  console.log(`[${input.logTag}] dispatch start`);

  try {
    const apiKey = process.env.RAMPWIN_API_KEY;
    const channelId = process.env.RAMPWIN_CHANNEL_ID;
    if (!apiKey || !channelId) {
      console.error(
        `[${input.logTag}] missing env vars — required: RAMPWIN_API_KEY, RAMPWIN_CHANNEL_ID`,
      );
      return { delivered: false };
    }

    const apiUrl = process.env.RAMPWIN_API_URL?.trim() || DEFAULT_API_URL;

    // Patient phone normalised to digits-only "91XXXXXXXXXX".
    const digits = input.patientPhone.replace(/\D/g, "");
    const phone = digits.startsWith("91") ? digits : `91${digits}`;
    if (!/^91\d{10}$/.test(phone)) {
      console.error(
        `[${input.logTag}] patient phone has unexpected format: ${input.patientPhone}`,
      );
      return { delivered: false };
    }

    const body = {
      channel_id: channelId,
      phone_number: phone,
      hide_from_chat: false,
      template: {
        name: input.templateName,
        language: { policy: "deterministic", code: "en" },
        category: "UTILITY",
        components: [
          {
            type: "body",
            parameters: input.bodyParams.map((text) => ({
              type: "text" as const,
              text: text.trim() || "—",
            })),
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
      console.error(`[${input.logTag}] network error reaching Rampwin`, cause);
      return { delivered: false };
    }

    const json = (await response.json().catch(() => ({}))) as RampwinResponse;

    if (!response.ok || json.success !== true) {
      const detail =
        typeof json.error === "string"
          ? json.error
          : json.error?.message ?? json.message ?? "unknown";
      console.error(
        `[${input.logTag}] Rampwin send failed (HTTP ${response.status}): ${detail}`,
      );
      return { delivered: false };
    }

    return { delivered: true };
  } catch (cause) {
    console.error(`[${input.logTag}] unexpected failure`, cause);
    return { delivered: false };
  }
}

// ──────────────────────────────────────────────────────────────────────
// 1.1 sendBookingConfirmed — fires after sendAarogyaLeadAlert on a paid
//     booking (razorpay/verify non-lab + lab/create-booking-prepaid).
// ──────────────────────────────────────────────────────────────────────

export interface BookingConfirmedInput {
  /** bookings.patient_name (full); first token is used for {{1}}. */
  patientName: string;
  /** Canonical service slug — drives {{2}} label + {{4}} next-step line. */
  serviceSlug: ServiceSlug;
  /** bookings.booking_code, e.g. "SAN-B-00058" → {{3}}. */
  bookingCode: string;
  /** Patient phone in +91 / 91 / 10-digit form. */
  patientPhone: string;
}

export async function sendBookingConfirmed(
  input: BookingConfirmedInput,
): Promise<{ delivered: boolean }> {
  if (process.env.RAMPWIN_BOOKING_CONFIRMED_ENABLED === "false") {
    console.log(
      "[sanocare_booking_confirmed] disabled via RAMPWIN_BOOKING_CONFIRMED_ENABLED=false",
    );
    return { delivered: false };
  }
  const templateName =
    process.env.RAMPWIN_BOOKING_CONFIRMED_TEMPLATE_NAME?.trim() ||
    "sanocare_booking_confirmed";

  return dispatchTemplate({
    logTag: "sanocare_booking_confirmed",
    templateName,
    patientPhone: input.patientPhone,
    bodyParams: [
      firstName(input.patientName),
      getBookingLabel(input.serviceSlug),
      input.bookingCode?.trim() || "—",
      getBookingNextStep(input.serviceSlug),
    ],
  });
}

// ──────────────────────────────────────────────────────────────────────
// 1.2 sendVisitComplete — fires when ops marks a booking COMPLETED.
//     Template carries 3 static Quick-Reply buttons (Extremely Satisfied /
//     Satisfied / Service needs improvement). Receiving those replies
//     requires a Rampwin INBOUND webhook, which does not exist yet — see
//     the Slice 2a notes. This sender only handles the outbound send.
// ──────────────────────────────────────────────────────────────────────

export interface VisitCompleteInput {
  patientName: string;
  serviceSlug: ServiceSlug;
  patientPhone: string;
}

export async function sendVisitComplete(
  input: VisitCompleteInput,
): Promise<{ delivered: boolean }> {
  if (process.env.RAMPWIN_VISIT_COMPLETE_ENABLED === "false") {
    console.log(
      "[aarogya_visit_complete] disabled via RAMPWIN_VISIT_COMPLETE_ENABLED=false",
    );
    return { delivered: false };
  }
  const templateName =
    process.env.RAMPWIN_VISIT_COMPLETE_TEMPLATE_NAME?.trim() ||
    "aarogya_visit_complete";

  return dispatchTemplate({
    logTag: "aarogya_visit_complete",
    templateName,
    patientPhone: input.patientPhone,
    bodyParams: [firstName(input.patientName), getServiceLabel(input.serviceSlug)],
  });
}

// ──────────────────────────────────────────────────────────────────────
// 1.3 sendLabCollectionScheduled — fires when ops confirms a phlebotomist
//     + slot for a lab booking.
// ──────────────────────────────────────────────────────────────────────

/**
 * Lab collection time windows. The public lab flow offers exactly two
 * (service-catalog.md): morning 7–10 AM, evening 5–8 PM.
 */
export type LabTimeWindow = "7-10 AM" | "5-8 PM";

/**
 * Derive the collection window from the slot timestamp (IST hour): before
 * noon → morning, otherwise evening. Used by the ops action so it doesn't
 * need a separate morning/evening input.
 */
export function labTimeWindowFromDate(d: Date): LabTimeWindow {
  const istHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).format(d),
  );
  return istHour < 12 ? "7-10 AM" : "5-8 PM";
}

/**
 * Format the collection date for {{3}}: "Tomorrow, June 10" when the slot
 * falls on tomorrow (IST), else "June 10, 2026". US month-first form per
 * the template copy. All comparisons are done on the IST calendar day.
 */
export function formatCollectionDate(d: Date, now: Date): string {
  const tz = "Asia/Kolkata";
  const dayKey = (x: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(x);

  const target = dayKey(d);
  const tomorrow = dayKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  const monthDay = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "long",
    day: "numeric",
  }).format(d);

  if (target === tomorrow) return `Tomorrow, ${monthDay}`;

  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

export interface LabCollectionScheduledInput {
  patientName: string;
  /** bookings.assigned_paramedic (text) — phlebotomist name → {{2}}. */
  phlebotomistName: string;
  /** Slot start; formatted to "Tomorrow, June 10" / "June 10, 2026". */
  scheduledFor: Date;
  /** Collection window → {{4}}. */
  timeWindow: LabTimeWindow;
  patientPhone: string;
  /**
   * Injected "now" for deterministic tests; defaults to real now. Kept
   * out of the public ops path (callers omit it).
   */
  now?: Date;
}

export async function sendLabCollectionScheduled(
  input: LabCollectionScheduledInput,
): Promise<{ delivered: boolean }> {
  if (process.env.RAMPWIN_LAB_COLLECTION_ENABLED === "false") {
    console.log(
      "[sanocare_lab_collection_scheduled] disabled via RAMPWIN_LAB_COLLECTION_ENABLED=false",
    );
    return { delivered: false };
  }
  const templateName =
    process.env.RAMPWIN_LAB_COLLECTION_TEMPLATE_NAME?.trim() ||
    "sanocare_lab_collection_scheduled";

  return dispatchTemplate({
    logTag: "sanocare_lab_collection_scheduled",
    templateName,
    patientPhone: input.patientPhone,
    bodyParams: [
      firstName(input.patientName),
      input.phlebotomistName.trim() || "your phlebotomist",
      formatCollectionDate(input.scheduledFor, input.now ?? new Date()),
      input.timeWindow,
    ],
  });
}
