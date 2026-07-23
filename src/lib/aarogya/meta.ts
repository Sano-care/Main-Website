// T-Prong-B C2 — Meta-direct successor to src/lib/aarogya/rampwin.ts.
// Three patient-facing templates:
//
//   sendBookingConfirmed       — sanocare_booking_confirmed (4 vars)
//   sendVisitComplete          — aarogya_visit_complete (2 vars + 3
//                                                         static QR buttons)
//   sendLabCollectionScheduled — sanocare_lab_collection_scheduled (4 vars)
//
// Behavioral contract preserved from Rampwin original:
//   - Best-effort: NEVER throws on the caller. Booking row is source of
//     truth; WhatsApp is convenience.
//   - Returns { delivered: boolean }.
//   - Per-template enable flag short-circuits with a log line.
//
// Env vars (new — explicit "true" required):
//   WHATSAPP_BOOKING_CONFIRMED_ENABLED
//   WHATSAPP_VISIT_COMPLETE_ENABLED
//   WHATSAPP_LAB_COLLECTION_ENABLED
//
// Template names are code constants. Static QR buttons on
// aarogya_visit_complete are template-fixtures — no `button` component
// needed in the send payload (Rampwin original handled it the same way).

import type { ServiceSlug } from "@/lib/services/catalog";
import {
  firstName,
  getBookingLabel,
  getBookingNextStep,
  getServiceLabel,
} from "@/lib/aarogya/labels";
import { sendTemplateMessage } from "@/lib/whatsapp/cloud-api";
import { isPhoneOptedOut } from "@/lib/whatsapp/db";
import { AuditEvent, writeAudit } from "@/lib/whatsapp/safety/audit";

/** New booking → Aarogya engagement opener flag (default OFF — ships inert
 *  until `aarogya_booking_confirmed` is APPROVED at Meta + smoke-tested). When
 *  ON, sendBookingConfirmed sends the reply-invite opener instead of the
 *  one-way confirmation, so the patient's reply opens a coordination thread. */
export const BOOKING_ENGAGEMENT_FLAG = "WHATSAPP_BOOKING_ENGAGEMENT_ENABLED";
export const BOOKING_ENGAGEMENT_TEMPLATE = "aarogya_booking_confirmed";

interface DispatchInput {
  logTag: string;
  templateName: string;
  patientPhone: string;
  bodyParams: string[];
}

async function dispatchTemplate(
  input: DispatchInput,
): Promise<{ delivered: boolean }> {
  console.log(`[${input.logTag}] dispatch start`);

  try {
    const digits = input.patientPhone.replace(/\D/g, "");
    const phone = digits.startsWith("91") ? digits : `91${digits}`;
    if (!/^91\d{10}$/.test(phone)) {
      console.error(
        `[${input.logTag}] patient phone has unexpected format: ${input.patientPhone}`,
      );
      return { delivered: false };
    }

    await sendTemplateMessage({
      to: phone,
      templateName: input.templateName,
      bodyParams: input.bodyParams.map((t) => t.trim() || "—"),
    });

    return { delivered: true };
  } catch (cause) {
    console.error(`[${input.logTag}] send failed`, cause);
    return { delivered: false };
  }
}

// ──────────────────────────────────────────────────────────────────────
// sendBookingConfirmed — sanocare_booking_confirmed
// ──────────────────────────────────────────────────────────────────────

export interface BookingConfirmedInput {
  patientName: string;
  serviceSlug: ServiceSlug;
  bookingCode: string;
  patientPhone: string;
  /**
   * PB4a — optional replacement for the canned `{{4}}` next-step line. The
   * native teleconsult booking passes the scheduled slot + link-timing note
   * ("Scheduled for <date, time>. Your video link arrives ~10 min before.").
   * Existing callers omit it and keep the per-service `getBookingNextStep`.
   * Only affects the 4-var `sanocare_booking_confirmed` path — the 2-var
   * engagement opener (when WHATSAPP_BOOKING_ENGAGEMENT_ENABLED) has no {{4}}.
   */
  nextStepOverride?: string;
}

export async function sendBookingConfirmed(
  input: BookingConfirmedInput,
): Promise<{ delivered: boolean }> {
  // Engagement opener (new) — when ENABLED, send the confirm+invite template so
  // the patient's reply opens an Aarogya coordination thread. Replaces (not
  // duplicates) the one-way confirmation; falls back to it when the flag is
  // OFF, so confirmations never stop. Every existing caller (razorpay/verify +
  // lab create-booking-prepaid, covering all services + both lab modes) goes
  // through this one function, so the opener is universal once flipped on.
  if (process.env[BOOKING_ENGAGEMENT_FLAG] === "true") {
    return sendBookingEngagementOpener(input);
  }
  if (process.env.WHATSAPP_BOOKING_CONFIRMED_ENABLED !== "true") {
    console.log(
      "[sanocare_booking_confirmed] disabled via WHATSAPP_BOOKING_CONFIRMED_ENABLED!=true",
    );
    return { delivered: false };
  }
  return dispatchTemplate({
    logTag: "sanocare_booking_confirmed",
    templateName: "sanocare_booking_confirmed",
    patientPhone: input.patientPhone,
    bodyParams: [
      firstName(input.patientName),
      getBookingLabel(input.serviceSlug),
      input.bookingCode?.trim() || "—",
      input.nextStepOverride?.trim() || getBookingNextStep(input.serviceSlug),
    ],
  });
}

/**
 * Confirm + coordinate opener — `aarogya_booking_confirmed` (2 vars: name,
 * service). Respects `conversations.opt_out` (a patient who replied STOP gets
 * no proactive send, even this utility); audits SENT / SKIPPED phone-free.
 * Best-effort like the rest of meta.ts — never throws on the booking path.
 */
async function sendBookingEngagementOpener(
  input: BookingConfirmedInput,
): Promise<{ delivered: boolean }> {
  if (await isPhoneOptedOut(input.patientPhone)) {
    await writeAudit({
      eventType: AuditEvent.BOOKING_ENGAGEMENT_SKIPPED,
      eventData: {
        reason: "opted_out",
        service: input.serviceSlug,
        booking: input.bookingCode?.trim() || null,
      },
    });
    return { delivered: false };
  }

  const res = await dispatchTemplate({
    logTag: BOOKING_ENGAGEMENT_TEMPLATE,
    templateName: BOOKING_ENGAGEMENT_TEMPLATE,
    patientPhone: input.patientPhone,
    bodyParams: [firstName(input.patientName), getServiceLabel(input.serviceSlug)],
  });

  await writeAudit({
    eventType: res.delivered
      ? AuditEvent.BOOKING_ENGAGEMENT_SENT
      : AuditEvent.BOOKING_ENGAGEMENT_SKIPPED,
    eventData: {
      service: input.serviceSlug,
      booking: input.bookingCode?.trim() || null,
      ...(res.delivered ? {} : { reason: "send_failed" }),
    },
  });
  return res;
}

// ──────────────────────────────────────────────────────────────────────
// sendVisitComplete — aarogya_visit_complete (template-static QR buttons)
// ──────────────────────────────────────────────────────────────────────

export interface VisitCompleteInput {
  patientName: string;
  serviceSlug: ServiceSlug;
  patientPhone: string;
}

export async function sendVisitComplete(
  input: VisitCompleteInput,
): Promise<{ delivered: boolean }> {
  if (process.env.WHATSAPP_VISIT_COMPLETE_ENABLED !== "true") {
    console.log(
      "[aarogya_visit_complete] disabled via WHATSAPP_VISIT_COMPLETE_ENABLED!=true",
    );
    return { delivered: false };
  }
  return dispatchTemplate({
    logTag: "aarogya_visit_complete",
    templateName: "aarogya_visit_complete",
    patientPhone: input.patientPhone,
    bodyParams: [firstName(input.patientName), getServiceLabel(input.serviceSlug)],
  });
}

// ──────────────────────────────────────────────────────────────────────
// sendLabCollectionScheduled — sanocare_lab_collection_scheduled
// ──────────────────────────────────────────────────────────────────────

export type LabTimeWindow = "7-10 AM" | "5-8 PM";

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
  phlebotomistName: string;
  scheduledFor: Date;
  timeWindow: LabTimeWindow;
  patientPhone: string;
  now?: Date;
}

export async function sendLabCollectionScheduled(
  input: LabCollectionScheduledInput,
): Promise<{ delivered: boolean }> {
  if (process.env.WHATSAPP_LAB_COLLECTION_ENABLED !== "true") {
    console.log(
      "[sanocare_lab_collection_scheduled] disabled via WHATSAPP_LAB_COLLECTION_ENABLED!=true",
    );
    return { delivered: false };
  }
  return dispatchTemplate({
    logTag: "sanocare_lab_collection_scheduled",
    templateName: "sanocare_lab_collection_scheduled",
    patientPhone: input.patientPhone,
    bodyParams: [
      firstName(input.patientName),
      input.phlebotomistName.trim() || "your phlebotomist",
      formatCollectionDate(input.scheduledFor, input.now ?? new Date()),
      input.timeWindow,
    ],
  });
}
