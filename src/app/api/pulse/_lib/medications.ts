import "server-only";

import { addDaysYMD, istTodayYMD, istWallTimeToUtc, maxYMD } from "./ist";

// Medication scheduling + Rx-import heuristics for the Pulse API.
//
// Two concerns live here:
//   1. expandIntakeLog — fan a medication's scheduled_times out into concrete
//      medication_intake_log rows for the next N days (default 14). Called on
//      POST /api/pulse/medications and on import.
//   2. The lossy Rx mapper — turn prescription_items' free-text frequency /
//      duration into times_per_day + scheduled_times + end_date, flagging
//      imported_needs_review whenever a value was synthesised rather than read
//      from the Rx. Defaults are LOCKED in the T62 plan-of-record (§3).

export const INTAKE_LOG_DAYS = 14;

/**
 * Canonical IST clock times by doses-per-day. These are HEURISTIC — the Rx
 * text almost never carries exact clock times, so any schedule built from
 * these is review-worthy. Mirrors T62 plan §3 / step 5.
 */
export const SCHEDULE_DEFAULTS: Record<number, string[]> = {
  1: ["09:00"],
  2: ["08:00", "20:00"],
  3: ["08:00", "14:00", "21:00"],
  4: ["07:00", "13:00", "19:00", "23:00"],
};

/** Normalise an arbitrary scheduled_times value into a clean "HH:MM"[] array. */
export function normaliseScheduledTimes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter((t) => /^\d{2}:\d{2}$/.test(t));
}

export interface IntakeLogRow {
  medication_id: string;
  scheduled_at: string; // UTC ISO
  state: "pending";
}

/**
 * Build the next `days` days of pending intake-log rows for a medication.
 *
 * Anchors at the later of (medication start_date, today IST) so a past
 * start_date doesn't backfill missed doses, and respects end_date as a hard
 * stop. Each scheduled clock time on each in-window day becomes one row.
 */
export function expandIntakeLog(params: {
  medicationId: string;
  scheduledTimes: string[];
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD
  days?: number;
  now?: Date;
}): IntakeLogRow[] {
  const { medicationId, scheduledTimes, startDate, endDate } = params;
  const days = params.days ?? INTAKE_LOG_DAYS;
  const times = normaliseScheduledTimes(scheduledTimes);
  if (times.length === 0) return [];

  const today = istTodayYMD(params.now);
  const anchor = startDate ? maxYMD(startDate, today) : today;

  const rows: IntakeLogRow[] = [];
  for (let d = 0; d < days; d++) {
    const ymd = addDaysYMD(anchor, d);
    if (endDate && ymd > endDate) break; // past the course — stop.
    for (const hhmm of times) {
      const instant = istWallTimeToUtc(ymd, hhmm);
      if (!instant) continue;
      rows.push({
        medication_id: medicationId,
        scheduled_at: instant.toISOString(),
        state: "pending",
      });
    }
  }
  return rows;
}

// ===== Rx free-text → schedule mapper =====

export interface MappedFrequency {
  timesPerDay: number;
  scheduledTimes: string[];
  /** True when clock times were synthesised (always true at v0 — see note). */
  heuristic: boolean;
}

/**
 * Map a prescription_item.frequency free-text to a dose count + IST clock
 * times. The clock times are ALWAYS synthesised from SCHEDULE_DEFAULTS (the
 * Rx never states "08:00"), so `heuristic` is true on every successful parse
 * — the importer surfaces a "review" pill so the patient can confirm the
 * times. Unparseable text falls back to once-daily 09:00.
 */
export function mapFrequency(freqText: string | null | undefined): MappedFrequency {
  const t = (freqText ?? "").toLowerCase();

  let timesPerDay: number | null = null;

  // Word + abbreviation + "Nx" forms. Order matters: check 4 → 3 → 2 → 1.
  if (/\b(four|4)\b|\bqid\b|\bq6h\b|\b4\s*x\b|\b4\s*times\b/.test(t)) {
    timesPerDay = 4;
  } else if (/\b(thrice|three|3)\b|\btid\b|\bq8h\b|\b3\s*x\b|\b3\s*times\b/.test(t)) {
    timesPerDay = 3;
  } else if (
    /\b(twice|two|2)\b|\bbid\b|\bbd\b|\bq12h\b|\b2\s*x\b|\b2\s*times\b/.test(t)
  ) {
    timesPerDay = 2;
  } else if (
    /\b(once|one|1)\b|\bod\b|\bhs\b|\bdaily\b|\bq24h\b|\b1\s*x\b|\bevery day\b/.test(t)
  ) {
    timesPerDay = 1;
  }

  if (timesPerDay === null) {
    // Unparseable — once-daily default.
    return { timesPerDay: 1, scheduledTimes: SCHEDULE_DEFAULTS[1], heuristic: true };
  }

  return {
    timesPerDay,
    scheduledTimes: SCHEDULE_DEFAULTS[timesPerDay] ?? SCHEDULE_DEFAULTS[1],
    // Clock times are synthesised on every import path → always review-worthy.
    heuristic: true,
  };
}

export interface MappedDuration {
  days: number | null;
  heuristic: boolean;
}

/**
 * Parse a prescription_item.duration free-text into a day count. Supports
 * "N day(s)", "N week(s)", "N month(s)", and a bare integer (read as days).
 * Returns { days: null, heuristic: true } when nothing parses — the caller
 * leaves end_date NULL and flags the row for review.
 */
export function mapDuration(durText: string | null | undefined): MappedDuration {
  const t = (durText ?? "").toLowerCase().trim();
  if (!t) return { days: null, heuristic: true };

  const m = t.match(/(\d+)\s*(day|days|week|weeks|month|months)?/);
  if (!m) return { days: null, heuristic: true };

  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return { days: null, heuristic: true };

  const unit = m[2] ?? "day";
  if (unit.startsWith("week")) return { days: n * 7, heuristic: false };
  if (unit.startsWith("month")) return { days: n * 30, heuristic: false };
  // "day(s)" or bare integer.
  return { days: n, heuristic: false };
}
