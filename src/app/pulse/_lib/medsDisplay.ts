// Presentation helpers for the medications surface. Pure functions, no JSX /
// no server-only, so the client surface and any SSR tile share one vocabulary.

import type { Medication, ScheduledDose } from "./pulseTypes";

// Client-side mirror of the server SCHEDULE_DEFAULTS (api/pulse/_lib/medications
// is server-only and can't be imported here). Keep in lockstep with that file.
const SCHEDULE_DEFAULTS_CLIENT: Record<number, string[]> = {
  0: [],
  1: ["09:00"],
  2: ["08:00", "20:00"],
  3: ["08:00", "14:00", "21:00"],
  4: ["07:00", "13:00", "19:00", "23:00"],
  5: ["07:00", "11:00", "15:00", "19:00", "23:00"],
  6: ["06:00", "10:00", "14:00", "18:00", "21:00", "23:00"],
};

/** Default IST clock times for a doses-per-day count (1–6). */
export function defaultTimesFor(n: number): string[] {
  return SCHEDULE_DEFAULTS_CLIENT[n] ?? ["09:00"];
}

// Client-side "today in IST" as YYYY-MM-DD. Uses Intl.DateTimeFormat (NOT the
// toLocale* methods the T51 ESLint guardrail bans) — en-CA renders ISO-style.
const istYmdFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function istTodayYMDClient(): string {
  return istYmdFormatter.format(new Date());
}

export type DoseVisual = "upcoming" | "taken" | "skipped" | "missed";

/**
 * How a dose should read on screen. An overdue still-"pending" dose (its time
 * has passed and it was never marked) renders as "missed" — matching how the
 * adherence route counts it — while a future pending dose is "upcoming".
 */
export function doseVisual(dose: ScheduledDose, now: Date = new Date()): DoseVisual {
  if (dose.state === "taken") return "taken";
  if (dose.state === "skipped") return "skipped";
  if (dose.state === "missed") return "missed";
  // pending
  return new Date(dose.scheduled_at).getTime() < now.getTime()
    ? "missed"
    : "upcoming";
}

export interface RefillStatus {
  warn: boolean;
  daysLeft: number | null;
}

/**
 * Refill warning: warn when the remaining supply covers no more than the
 * medication's threshold number of days. daysLeft = supply_qty / times_per_day.
 * Returns warn=false when supply is unknown or the med isn't a daily schedule.
 */
export function refillStatus(med: Medication): RefillStatus {
  const perDay = med.times_per_day ?? 0;
  if (med.supply_qty == null || perDay <= 0) {
    return { warn: false, daysLeft: null };
  }
  const daysLeft = med.supply_qty / perDay;
  const threshold = med.refill_warning_threshold_days ?? 5;
  return { warn: daysLeft <= threshold, daysLeft: Math.floor(daysLeft) };
}

/** "92% (28/30)" given an adherence rate + taken/due counts. */
export function formatAdherence(
  rate: number | null,
  taken: number,
  due: number,
): string {
  if (rate == null || due === 0) return "No doses due yet";
  return `${Math.round(rate * 100)}% (${taken}/${due})`;
}

/** A short human schedule line, e.g. "Twice daily · 8:00 AM, 8:00 PM". */
export function scheduleSummary(med: Medication): string {
  const times = med.scheduled_times ?? [];
  if (times.length === 0) return med.frequency_label;
  const pretty = times.map(formatClock).join(", ");
  return `${med.frequency_label} · ${pretty}`;
}

/** "08:00" → "8:00 AM" (pure string transform; no Date, no locale API). */
export function formatClock(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const mer = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${mer}`;
}
