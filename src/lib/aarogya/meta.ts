// T-Prong-B C2 (shell, signatures only) — Meta-direct successor to
// src/lib/aarogya/rampwin.ts. Three patient-facing templates:
//
//   sendBookingConfirmed       — sanocare_booking_confirmed (4 vars)
//   sendVisitComplete          — aarogya_visit_complete (2 vars + 3 static
//                                                         QR buttons)
//   sendLabCollectionScheduled — sanocare_lab_collection_scheduled (4 vars)
//
// Behavioral contract preserved from Rampwin original:
//   - Best-effort: NEVER throws on the caller. Booking row is source of
//     truth; WhatsApp is convenience.
//   - Returns { delivered: boolean }.
//   - Per-template enable flag short-circuits with a log line.
//
// Env vars (new — replace RAMPWIN_*_ENABLED equivalents):
//   WHATSAPP_BOOKING_CONFIRMED_ENABLED
//   WHATSAPP_VISIT_COMPLETE_ENABLED
//   WHATSAPP_LAB_COLLECTION_ENABLED
//
// All three default to OFF unless explicitly "true" (matches Prong A
// WHATSAPP_OTP_ENABLED pattern). Template names are code constants;
// the Rampwin _TEMPLATE_NAME override pattern is dropped.
//
// Static QR buttons on aarogya_visit_complete don't need a `button`
// component in the send payload — Meta treats template-static buttons
// as fixtures (same as the Rampwin original handled it).

import type { ServiceSlug } from "@/lib/services/catalog";

// ──────────────────────────────────────────────────────────────────────
// sendBookingConfirmed — sanocare_booking_confirmed
// ──────────────────────────────────────────────────────────────────────

export interface BookingConfirmedInput {
  /** bookings.patient_name (full); first token used for {{1}}. */
  patientName: string;
  /** Canonical service slug — drives {{2}} label + {{4}} next-step line. */
  serviceSlug: ServiceSlug;
  /** bookings.booking_code, e.g. "SAN-B-00058" → {{3}}. */
  bookingCode: string;
  /** Patient phone in +91 / 91 / 10-digit form. */
  patientPhone: string;
}

/**
 * Fire booking-confirmation template to patient. Best-effort; never throws.
 *
 * BODY VARS (positional, 4):
 *   {{1}} firstName(patientName)
 *   {{2}} getBookingLabel(serviceSlug)
 *   {{3}} bookingCode.trim() || "—"
 *   {{4}} getBookingNextStep(serviceSlug)
 */
export async function sendBookingConfirmed(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- shell only
  input: BookingConfirmedInput,
): Promise<{ delivered: boolean }> {
  throw new Error("sendBookingConfirmed: implementation lands in C2");
}

// ──────────────────────────────────────────────────────────────────────
// sendVisitComplete — aarogya_visit_complete
// ──────────────────────────────────────────────────────────────────────

export interface VisitCompleteInput {
  patientName: string;
  serviceSlug: ServiceSlug;
  patientPhone: string;
}

/**
 * Fire visit-complete template (with 3 static QR feedback buttons) to
 * patient. Best-effort; never throws.
 *
 * BODY VARS (positional, 2):
 *   {{1}} firstName(patientName)
 *   {{2}} getServiceLabel(serviceSlug)
 *
 * QR buttons are template-static — no send-time payload needed.
 */
export async function sendVisitComplete(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- shell only
  input: VisitCompleteInput,
): Promise<{ delivered: boolean }> {
  throw new Error("sendVisitComplete: implementation lands in C2");
}

// ──────────────────────────────────────────────────────────────────────
// sendLabCollectionScheduled — sanocare_lab_collection_scheduled
// ──────────────────────────────────────────────────────────────────────

/**
 * Lab collection time windows. Public lab flow offers exactly two:
 * morning 7-10 AM, evening 5-8 PM.
 */
export type LabTimeWindow = "7-10 AM" | "5-8 PM";

/**
 * Derive window from slot timestamp (IST hour): before noon → morning,
 * otherwise evening. Pure function — reused as-is from the Rampwin
 * original (same logic, no transport dependency).
 */
export function labTimeWindowFromDate(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- shell only
  d: Date,
): LabTimeWindow {
  throw new Error("labTimeWindowFromDate: implementation lands in C2");
}

/**
 * Format collection date as "Tomorrow, June 10" or "June 10, 2026" in IST.
 * Pure function — reused as-is from the Rampwin original.
 */
export function formatCollectionDate(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- shell only
  d: Date,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- shell only
  now: Date,
): string {
  throw new Error("formatCollectionDate: implementation lands in C2");
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
  /** Injected "now" for deterministic tests; defaults to real now. */
  now?: Date;
}

/**
 * Fire lab-collection-scheduled template to patient. Best-effort; never
 * throws.
 *
 * BODY VARS (positional, 4):
 *   {{1}} firstName(patientName)
 *   {{2}} phlebotomistName.trim() || "your phlebotomist"
 *   {{3}} formatCollectionDate(scheduledFor, now)
 *   {{4}} timeWindow
 */
export async function sendLabCollectionScheduled(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- shell only
  input: LabCollectionScheduledInput,
): Promise<{ delivered: boolean }> {
  throw new Error("sendLabCollectionScheduled: implementation lands in C2");
}
