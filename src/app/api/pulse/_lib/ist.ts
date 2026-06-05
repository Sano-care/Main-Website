import "server-only";

// IST date arithmetic for the Pulse medication scheduler + importer.
//
// India runs a fixed +05:30 offset with no DST, so IST wall-clock ↔ UTC is a
// pure constant-offset conversion — no tz database lookup needed for the
// CONSTRUCTION side. We build an ISO string carrying the literal "+05:30"
// offset and let the engine resolve the UTC instant; `.toISOString()` then
// yields canonical UTC for storage in `timestamptz` columns.
//
// This is construction, not presentation — user-visible rendering still goes
// through src/lib/time/formatIST.ts. We use Intl.DateTimeFormat (NOT the
// toLocale* methods the T51 ESLint guardrail bans) only to read "today" in
// IST as Y-M-D parts.

const IST_OFFSET = "+05:30";

const istDateParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "today" in IST as a YYYY-MM-DD string. */
export function istTodayYMD(now: Date = new Date()): string {
  // en-CA renders ISO-style YYYY-MM-DD with literal dashes.
  return istDateParts.format(now);
}

/** Add `n` whole days to a YYYY-MM-DD string, returning YYYY-MM-DD. */
export function addDaysYMD(ymd: string, n: number): string {
  // Anchor at IST noon so ±offset never rolls the calendar date over.
  const base = new Date(`${ymd}T12:00:00${IST_OFFSET}`);
  base.setUTCDate(base.getUTCDate() + n);
  return istDateParts.format(base);
}

/**
 * Combine an IST calendar date (YYYY-MM-DD) and an IST wall-clock time
 * ("HH:MM") into the corresponding UTC instant. Returns null if either part
 * is malformed.
 */
export function istWallTimeToUtc(ymd: string, hhmm: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const d = new Date(`${ymd}T${hhmm}:00${IST_OFFSET}`);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Compare two YYYY-MM-DD strings lexically (safe for ISO dates). */
export function maxYMD(a: string, b: string): string {
  return a >= b ? a : b;
}
