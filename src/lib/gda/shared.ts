// GDA / Attendant Phase 1 (M064) — shared constants + pure helpers.
//
// Pure (no "server-only", no DB) so vitest can exercise the validation and the
// vitals parsing directly. Used by the ops API, the medic-app GDA API, and the
// vitals-mirror path.

// ── Shift + deployment vocabularies (mirror the M064 CHECK constraints) ──────
export const SHIFT_PATTERNS = ["12h", "24h"] as const;
export type ShiftPattern = (typeof SHIFT_PATTERNS)[number];

export const SHIFT_KINDS = ["day12", "night12", "full24"] as const;
export type ShiftKind = (typeof SHIFT_KINDS)[number];

export const DEPLOYMENT_STATUSES = ["active", "paused", "ended"] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export const SHIFT_STATUSES = [
  "scheduled",
  "in_progress",
  "done",
  "missed",
] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

// Which shift_kind is valid for a given pattern. A 12h deployment runs day/night
// 12h shifts; a 24h deployment runs full24 shifts.
export function shiftKindAllowedForPattern(
  pattern: ShiftPattern,
  kind: ShiftKind,
): boolean {
  if (pattern === "12h") return kind === "day12" || kind === "night12";
  return kind === "full24";
}

// ── The 15 checklist tasks (D2 — GDA performs ALL of them) ───────────────────
// Order is the founder's task list; the client renders in this order. NO
// household tasks are present by design (D2 scope is clinical/personal-care).
export const GDA_TASK_KEYS = [
  "bed_sheet",
  "sponge",
  "diaper",
  "position",
  "bed_pan",
  "sitting",
  "vaporizer",
  "insulin",
  "nebulization",
  "bp",
  "pulse",
  "sugar",
  "temperature",
  "exercises",
  "medication",
] as const;
export type GdaTaskKey = (typeof GDA_TASK_KEYS)[number];

export function isGdaTaskKey(v: unknown): v is GdaTaskKey {
  return (
    typeof v === "string" && (GDA_TASK_KEYS as readonly string[]).includes(v)
  );
}

// The line the medic-app renders so a GDA never sees household chores surfaced.
export const NO_HOUSEHOLD_WORK_NOTE =
  "Clinical & personal-care tasks only — no household work.";

// ── Vitals mirror (C5) ───────────────────────────────────────────────────────
// Checklist vital task_keys → vital_readings.kind. Only these four mirror; every
// other task_key is checklist-only.
export const VITAL_TASK_TO_KIND: Record<string, string> = {
  bp: "bp",
  pulse: "pulse_bpm",
  sugar: "sugar_random",
  temperature: "temperature_c",
};

export function isVitalTaskKey(taskKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(VITAL_TASK_TO_KIND, taskKey);
}

export interface ParsedVital {
  kind: string;
  value_numeric: number;
  value_secondary: number | null;
}

/**
 * Parse a checklist vital's free-text `value` into the numeric shape
 * vital_readings needs. Returns null when the text can't be parsed to a number
 * (caller then skips the mirror — the checklist row still saves).
 *
 *   bp          "120/80" → { kind:'bp', value_numeric:120, value_secondary:80 }
 *   pulse       "78"     → { kind:'pulse_bpm', value_numeric:78 }
 *   sugar       "110"    → { kind:'sugar_random', value_numeric:110 }
 *   temperature "98.6"   → { kind:'temperature_c', value_numeric:98.6 }
 */
export function parseVital(
  taskKey: string,
  raw: string | null | undefined,
): ParsedVital | null {
  if (!isVitalTaskKey(taskKey)) return null;
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text === "") return null;

  const kind = VITAL_TASK_TO_KIND[taskKey];

  if (taskKey === "bp") {
    // systolic/diastolic — tolerate "120/80", "120 / 80", "120-80".
    const m = text.match(/^(\d{2,3})\s*[/\-]\s*(\d{2,3})$/);
    if (!m) return null;
    const systolic = Number(m[1]);
    const diastolic = Number(m[2]);
    if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) return null;
    return { kind, value_numeric: systolic, value_secondary: diastolic };
  }

  // Single number; allow a trailing unit token ("98.6 F", "110 mg/dl").
  const m = text.match(/^(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  return { kind, value_numeric: value, value_secondary: null };
}

// ── Misc shared helpers ──────────────────────────────────────────────────────
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Today's date in IST (UTC+05:30, no DST), as YYYY-MM-DD. */
export function todayInIST(): string {
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}
