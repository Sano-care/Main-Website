// T64 — display helpers for the family_members domain.
//
// Keep purely-presentational logic in this file so server pages, API
// routes, and client components share one source of truth for the
// relation labels + age calculation. No React, no DOM — safe to import
// from anywhere.

import type { Relation } from "./types";

/**
 * Human-readable label for each `relation` enum value. Used by the
 * AddMemberForm dropdown, the MemberCard subtitle, the booking-modal
 * member picker (PR2), and the aarogya_lead_alert {{5}} Context string.
 *
 * Capitalisation is brief-faithful: "Spouse" / "Father" / etc. — sentence
 * case looks gentler in patient-facing surfaces than ALL CAPS.
 */
export const RELATION_LABELS: Record<Relation, string> = {
  spouse: "Spouse",
  father: "Father",
  mother: "Mother",
  son: "Son",
  daughter: "Daughter",
  brother: "Brother",
  sister: "Sister",
  other: "Other",
};

/**
 * Resolve the display label for a member, accounting for the
 * relation='other' override stored in `relation_other`. Pass the row's
 * `relation` and (nullable) `relation_other` columns.
 *
 * Examples:
 *   relationDisplayLabel('father', null)              → 'Father'
 *   relationDisplayLabel('other', 'Father-in-law')    → 'Father-in-law'
 *   relationDisplayLabel('other', null)               → 'Other'      (defensive)
 */
export function relationDisplayLabel(
  relation: Relation,
  relationOther: string | null | undefined,
): string {
  if (relation === "other") {
    const trimmed = relationOther?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : "Other";
  }
  return RELATION_LABELS[relation];
}

/**
 * Compute age in completed years from a date-of-birth string. Returns
 * null when `dob` is null/undefined/empty/unparseable, mirroring the
 * "—y" fallback the aarogya_lead_alert template uses for unknown ages.
 *
 * Implementation: floor-divides the millisecond delta by the average
 * year (365.25 days). Off-by-one edge cases (e.g. someone exactly on
 * their birthday in a leap year) average out at this resolution; we
 * don't need calendar-correct age math for "—y" surfacing.
 */
export function ageYearsFromDob(dob: string | null | undefined): number | null {
  if (!dob || typeof dob !== "string") return null;
  const parsed = new Date(dob);
  if (Number.isNaN(parsed.getTime())) return null;
  const ms = Date.now() - parsed.getTime();
  if (ms < 0) return null; // future DOB — treat as missing
  const years = Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000));
  return years;
}

/**
 * Render the age string used in lead-alert {{2}} and member-card UI.
 * Returns "<N>y" when DOB resolves, "—y" otherwise. Single source of
 * truth so the booking modal, the family-members surface, and the
 * Rampwin sender all match.
 */
export function ageWithYearSuffix(dob: string | null | undefined): string {
  const years = ageYearsFromDob(dob);
  return years == null ? "—y" : `${years}y`;
}
