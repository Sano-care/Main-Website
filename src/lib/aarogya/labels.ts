// Aarogya Slice 2a — shared service-label helpers for the patient-facing
// WhatsApp template senders (src/lib/aarogya/rampwin.ts).
//
// All labels key off the canonical T85 `ServiceSlug` rather than the raw
// `bookings.service_category` string, because service_category is DIRTY
// (legacy + T85 values coexist post-M039). Call `serviceCategoryToSlug()`
// to normalize a raw column value to a slug before labelling.

import type { ServiceSlug } from "@/lib/services/catalog";
import { dbToT85Slug } from "@/lib/booking/serviceMapper";

/**
 * Booking-confirmation label — the `{{2}}` variable of
 * `sanocare_booking_confirmed` (carries the "Booking" suffix).
 */
export function getBookingLabel(slug: ServiceSlug): string {
  switch (slug) {
    case "home-visit":
      return "Home Visit Booking";
    case "teleconsultation":
      return "Teleconsultation Booking";
    case "medic-at-home":
      return "Medic at Home Booking";
    case "lab-tests":
      return "Lab Tests Booking";
  }
}

/**
 * Plain service label (NO "Booking" suffix) — the `{{2}}` variable of
 * `aarogya_visit_complete`.
 */
export function getServiceLabel(slug: ServiceSlug): string {
  switch (slug) {
    case "home-visit":
      return "Home Visit";
    case "teleconsultation":
      return "Teleconsultation";
    case "medic-at-home":
      return "Medic at Home";
    case "lab-tests":
      return "Lab Tests";
  }
}

/**
 * Next-step line — the `{{4}}` variable of `sanocare_booking_confirmed`.
 * Home Visit + Medic-at-Home share the Medic+doctor line; teleconsult and
 * lab each get their own.
 */
export function getBookingNextStep(slug: ServiceSlug): string {
  switch (slug) {
    case "home-visit":
    case "medic-at-home":
      return "Your Medic and doctor will be assigned shortly.";
    case "teleconsultation":
      return "Your doctor will be assigned shortly — you'll get a video link to join.";
    case "lab-tests":
      return "Your phlebotomist slot will be confirmed shortly.";
  }
}

/**
 * Normalize a raw `bookings.service_category` (legacy OR T85) to a
 * `ServiceSlug`. Falls back to `home-visit` for unmappable values
 * (`chronic`, unknown) so a patient-facing send never throws on a legacy
 * row — the patient still gets a coherent message and ops has the row.
 */
export function serviceCategoryToSlug(raw: string | null | undefined): ServiceSlug {
  return dbToT85Slug((raw ?? "").trim()) ?? "home-visit";
}

/**
 * First token of a patient name for a WhatsApp greeting. Falls back to
 * "there" ("Hi there") on empty input — booking routes validate the name
 * upstream, but ops-initiated sends read whatever is stored.
 */
export function firstName(patientName: string | null | undefined): string {
  const token = (patientName ?? "").trim().split(/\s+/)[0];
  return token || "there";
}
