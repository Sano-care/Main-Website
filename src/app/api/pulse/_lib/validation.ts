import "server-only";

// Shared request-validation primitives for the Pulse API routes.

export const VITAL_KINDS = [
  "bp",
  "sugar_fasting",
  "sugar_postprandial",
  "sugar_random",
  "weight_kg",
  "temperature_c",
  "spo2_pct",
  "pulse_bpm",
  "other",
] as const;

export type VitalKind = (typeof VITAL_KINDS)[number];

export function isVitalKind(v: unknown): v is VitalKind {
  return typeof v === "string" && (VITAL_KINDS as readonly string[]).includes(v);
}

export const INTAKE_STATES = ["pending", "taken", "skipped", "missed"] as const;
export type IntakeState = (typeof INTAKE_STATES)[number];

export function isIntakeState(v: unknown): v is IntakeState {
  return (
    typeof v === "string" && (INTAKE_STATES as readonly string[]).includes(v)
  );
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// Conditions + allergies (R2a). Mirror the DB CHECK constraints exactly so the
// route gives a friendly 400 rather than leaning on the CHECK to surface it.
export const RECORD_STATUSES = ["active", "resolved", "inactive"] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];
export function isRecordStatus(v: unknown): v is RecordStatus {
  return typeof v === "string" && (RECORD_STATUSES as readonly string[]).includes(v);
}

export const ALLERGY_SEVERITIES = ["mild", "moderate", "severe", "unknown"] as const;
export type AllergySeverity = (typeof ALLERGY_SEVERITIES)[number];
export function isAllergySeverity(v: unknown): v is AllergySeverity {
  return typeof v === "string" && (ALLERGY_SEVERITIES as readonly string[]).includes(v);
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate an ISO date (YYYY-MM-DD) for a `date` column; returns it or null. */
export function asYmdDate(v: unknown): string | null {
  if (typeof v !== "string" || !YMD_RE.test(v)) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? v : null;
}

/** Parse a finite number from unknown; returns null on failure. */
export function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Validate an ISO-8601 timestamp string; returns the canonical UTC ISO or null. */
export function asIsoTimestamp(v: unknown): string | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** Clamp a limit/offset query param to a sane range. */
export function parsePositiveInt(
  v: string | null,
  fallback: number,
  max: number,
): number {
  if (!v) return fallback;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}
