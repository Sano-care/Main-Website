// T64 — TypeScript types for the family_members domain.
//
// Schema source: supabase/migrations/042_family_members.sql.
// The DB CHECK constraints + the literal-union types here are deliberately
// kept in lock-step — if you change one, change the other.

/**
 * Closed enum of relations. Mirrors the CHECK constraint on
 * `family_members.relation`. There is intentionally no 'self' value —
 * Self bookings use `bookings.member_id = NULL` instead of a stored row.
 */
export type Relation =
  | "spouse"
  | "father"
  | "mother"
  | "son"
  | "daughter"
  | "brother"
  | "sister"
  | "other";

export const ALL_RELATIONS: readonly Relation[] = [
  "spouse",
  "father",
  "mother",
  "son",
  "daughter",
  "brother",
  "sister",
  "other",
] as const;

/** Same closed enum used by the gender column. */
export type Gender = "male" | "female" | "other" | "prefer-not-to-say";

export const ALL_GENDERS: readonly Gender[] = [
  "male",
  "female",
  "other",
  "prefer-not-to-say",
] as const;

/**
 * The shape of a row in `public.family_members`. Mirrors the column list
 * of M042 with all nullable fields surfaced as `T | null` (not optional
 * properties) so the client can render with confidence.
 */
export interface FamilyMember {
  id: string;
  customer_id: string;
  name: string;
  relation: Relation;
  /** Non-null iff `relation === 'other'`. DB CHECK enforces this. */
  relation_other: string | null;
  /** ISO-date string (`YYYY-MM-DD`), or null. */
  dob: string | null;
  gender: Gender | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Subset writable on POST. customer_id is server-resolved, never trusted from client. */
export interface FamilyMemberInsert {
  name: string;
  relation: Relation;
  relation_other?: string | null;
  dob?: string | null;
  gender?: Gender | null;
  notes?: string | null;
}

/** Subset writable on PATCH. Every field optional; server validates. */
export type FamilyMemberUpdate = Partial<FamilyMemberInsert>;
