// Pure builder for the /api/pulse/family-members POST/PATCH body.
//
// Extracted from AddMemberForm so the enum contract the route + DB CHECK
// enforce is unit-testable without a DOM. Keep in lock-step with
// `validateInsert` in src/app/api/pulse/family-members/route.ts.

import type { FamilyMemberInsert, Gender, Relation } from "./types";

export interface FamilyMemberFormState {
  name: string;
  relation: Relation;
  /** Raw free-text; only sent when relation === 'other'. */
  relationOther: string;
  /** ISO `YYYY-MM-DD` or "" (none). */
  dob: string;
  /** Enum value, or "" for the "no answer" placeholder. */
  gender: Gender | "";
  notes: string;
}

/**
 * Build the request body from the raw form fields. Centralises the contract:
 *   - `relation` is sent as the EXACT enum value (spouse|father|mother|son|
 *     daughter|brother|sister|other) — NEVER a display label like "Wife".
 *   - `relation_other` is the trimmed text ONLY when relation === 'other';
 *     null otherwise (a non-null value on a non-'other' relation trips the DB
 *     CHECK).
 *   - `gender` is the exact enum (male|female|other|prefer-not-to-say) or null
 *     — never the empty-string placeholder.
 *   - `dob` / `notes`: trimmed, empty → null.
 */
export function buildFamilyMemberPayload(
  s: FamilyMemberFormState,
): FamilyMemberInsert {
  return {
    name: s.name.trim(),
    relation: s.relation,
    relation_other: s.relation === "other" ? s.relationOther.trim() : null,
    dob: s.dob || null,
    gender: s.gender || null,
    notes: s.notes.trim() || null,
  };
}
