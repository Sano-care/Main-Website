// Single source of truth for every user-visible datetime in the Sanocare
// web app. Renders in Asia/Kolkata (IST) regardless of the visitor's
// browser locale. The literal "IST" suffix on time-bearing formats is
// intentional — patients ask "is this IST or my local time?" in WhatsApp
// threads often enough that the suffix saves real back-and-forth.
//
// Stored timestamps remain UTC at rest in Postgres (timestamptz); this
// helper is purely the presentation layer.
//
// Implementation: native Intl.DateTimeFormat + Intl.RelativeTimeFormat.
// No new deps. Same Intl tz database that dayjs.tz / date-fns-tz would
// resolve against under the hood — the wrapping libraries add zero
// functional value here.
//
// API:
//   formatIST(value)                     // "3 Jun 2026, 02:45 PM IST"
//   formatIST(value, "date")             // "3 Jun 2026"
//   formatIST(value, "dateLong")         // "3 June 2026"
//   formatIST(value, "time")             // "02:45 PM IST"
//   formatIST(value, "datetime")         // (same as default)
//   formatIST(value, "datetimeLong")     // "3 June 2026, 02:45 PM IST"
//   formatIST(value, "relativeShort")    // "12 min ago" / "in 2 hrs" / "yesterday"
//   formatIST(value, "iso")              // "2026-06-03T14:45:00+05:30"
//
// All formats render `—` for null / undefined / unparseable input.

const IST_TIMEZONE = "Asia/Kolkata";
const IST_LOCALE = "en-IN";

export type ISTFormat =
  | "date"
  | "dateLong"
  | "time"
  | "datetime"
  | "datetimeLong"
  | "relativeShort"
  | "iso";

/**
 * Coerce the input to a Date. Returns null if the value is nullish OR
 * can't be parsed (Invalid Date). Callers render "—" on null.
 */
function toDate(input: string | number | Date | null | undefined): Date | null {
  if (input == null) return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isFinite(d.getTime()) ? d : null;
}

// Memoised formatters. Constructing an Intl.DateTimeFormat is ~10x more
// expensive than calling .format() — for the sweep targets that render
// tables of N rows, sharing the formatter matters. Keyed by format.
const formatters: Partial<Record<ISTFormat, Intl.DateTimeFormat>> = {};

function getFormatter(format: ISTFormat): Intl.DateTimeFormat {
  const cached = formatters[format];
  if (cached) return cached;
  const fmt = buildFormatter(format);
  formatters[format] = fmt;
  return fmt;
}

function buildFormatter(format: ISTFormat): Intl.DateTimeFormat {
  switch (format) {
    case "date":
      return new Intl.DateTimeFormat(IST_LOCALE, {
        timeZone: IST_TIMEZONE,
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    case "dateLong":
      return new Intl.DateTimeFormat(IST_LOCALE, {
        timeZone: IST_TIMEZONE,
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    case "time":
      return new Intl.DateTimeFormat(IST_LOCALE, {
        timeZone: IST_TIMEZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    case "datetime":
      return new Intl.DateTimeFormat(IST_LOCALE, {
        timeZone: IST_TIMEZONE,
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    case "datetimeLong":
      return new Intl.DateTimeFormat(IST_LOCALE, {
        timeZone: IST_TIMEZONE,
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    case "iso":
      // Used inside formatIso() to extract Y-M-D h:m:s parts in IST.
      // The "+05:30" offset is appended manually because Intl doesn't
      // emit a timezone-offset token.
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: IST_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    case "relativeShort":
      // Stand-in; the actual relative formatting goes through the
      // separate Intl.RelativeTimeFormat instance below. Returning a
      // datetime formatter here keeps the type system happy without
      // ever being used.
      return new Intl.DateTimeFormat(IST_LOCALE);
  }
}

// Two RelativeTimeFormat instances. en-IN's "short" style abbreviates
// week → "wk" / month → "mo" which reads weirdly in an audit log;
// "long" style spells those out but stays compact for sub-day units
// only via the "auto" numeric strategy. The split:
//
//   second / minute / hour  →  short  ("5 min. ago",  "in 2 hr.")
//   day / week / month      →  long   ("yesterday",   "last week")
//
// Both share the numeric: "auto" setting which gives us "yesterday" /
// "last week" instead of "1 day ago" / "7 days ago".
const rtfShort = new Intl.RelativeTimeFormat(IST_LOCALE, {
  numeric: "auto",
  style: "short",
});
const rtfLong = new Intl.RelativeTimeFormat(IST_LOCALE, {
  numeric: "auto",
  style: "long",
});

/**
 * "5 min ago" / "in 2 hrs" / "yesterday" / "last week" / "12 Jan 2026"
 * once the gap exceeds a week (falls back to the "date" format).
 */
function formatRelativeShort(d: Date): string {
  const now = Date.now();
  const diffMs = d.getTime() - now; // negative = past, positive = future
  const absSec = Math.abs(diffMs) / 1000;
  if (absSec < 60) return rtfShort.format(Math.round(diffMs / 1000), "second");
  if (absSec < 60 * 60)
    return rtfShort.format(Math.round(diffMs / 60_000), "minute");
  if (absSec < 60 * 60 * 24)
    return rtfShort.format(Math.round(diffMs / 3_600_000), "hour");
  if (absSec < 60 * 60 * 24 * 7)
    return rtfLong.format(Math.round(diffMs / 86_400_000), "day");
  if (absSec < 60 * 60 * 24 * 30) {
    return rtfLong.format(Math.round(diffMs / (86_400_000 * 7)), "week");
  }
  // Past ~30 days, the relative form ("last month") is ambiguous for
  // ops audit reading. Fall through to absolute date.
  return getFormatter("date").format(d);
}

/**
 * "2026-06-03T14:45:00+05:30" — machine-readable IST with explicit
 * offset. Used for hover/detail-line audit log copy where you want a
 * disambiguated stamp.
 */
function formatIso(d: Date): string {
  const parts = getFormatter("iso").formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  // en-CA gives us YYYY-MM-DD with literal dashes already.
  const year = get("year");
  const month = get("month");
  const day = get("day");
  let hour = get("hour");
  const minute = get("minute");
  const second = get("second");
  // en-CA renders hour as "24" at midnight on some engines; normalise.
  if (hour === "24") hour = "00";
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`;
}

/**
 * The IST calendar date as "YYYY-MM-DD" for the given instant — the key
 * shape for presence_date / work_date (C3), which must align to the IST day,
 * not UTC. A 23:30 IST heartbeat is still "today" in Delhi even though it's
 * already tomorrow in UTC; a 04:00 IST heartbeat is still "today" even though
 * it's still yesterday in UTC. Either case keys the wrong calendar day if you
 * use the raw UTC date.
 *
 * Reuses the memoised "iso" formatter (en-CA, Asia/Kolkata), whose
 * year/month/day parts are already zero-padded and independent of the
 * hour="24"-at-midnight quirk that formatIso() normalises. Returns null for
 * nullish / unparseable input (callers fail closed).
 */
export function istDateISO(
  input: string | number | Date | null | undefined,
): string | null {
  const d = toDate(input);
  if (!d) return null;
  const parts = getFormatter("iso").formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Render a datetime value in IST.
 *
 * @param input  ISO string, epoch ms, or Date. null/undefined renders "—".
 * @param format See ISTFormat. Defaults to "datetime".
 */
export function formatIST(
  input: string | number | Date | null | undefined,
  format: ISTFormat = "datetime",
): string {
  const d = toDate(input);
  if (!d) return "—";
  switch (format) {
    case "date":
    case "dateLong":
      return getFormatter(format).format(d);
    case "time":
    case "datetime":
    case "datetimeLong":
      // Intl's en-IN renders the meridiem as lowercase "am"/"pm".
      // Uppercase it after rendering — cheaper + more locale-stable
      // than swapping the formatter. Same transformation for all
      // time-bearing formats; appends the literal " IST" suffix.
      return `${getFormatter(format).format(d).replace(/\bam\b/i, "AM").replace(/\bpm\b/i, "PM")} IST`;
    case "relativeShort":
      return formatRelativeShort(d);
    case "iso":
      return formatIso(d);
  }
}
