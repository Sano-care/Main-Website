// T90 Pulse v1 Phase 1 Slice 2 — Time-aware greeting helper.
//
// Server-only utility (no React imports → can run in either component
// world but the IST hour read must happen server-side to avoid a
// hydration mismatch on the greeting text). Called from
// `src/app/pulse/(authed)/page.tsx` which is `force-dynamic` + async,
// so `new Date()` always reflects the request's server time.
//
// IST hour buckets (brief copy spec, verbatim):
//   05:00–11:59 → "Good morning, {firstName}"
//   12:00–16:59 → "Good afternoon, {firstName}"
//   17:00–21:59 → "Good evening, {firstName}"
//   22:00–04:59 → "Hello, {firstName}"
//
// First-name handling:
//   - null / empty → returns the nameless variant
//   - >20 chars   → hard-truncated to 20 chars, no ellipsis (Indian
//                   single-word names commonly run long; ellipsis on
//                   a greeting reads broken). Defensive: also takes
//                   the first space-delimited word if a full name
//                   gets passed accidentally.

const NAME_MAX_LENGTH = 20;

type Period = "morning" | "afternoon" | "evening" | "hello";

const PERIOD_COPY: Record<Period, string> = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
  hello: "Hello",
};

/**
 * Returns the time-aware greeting string for the current IST hour.
 * Pass the user's first name (or null for nameless greeting).
 * Caller owns any surrounding punctuation — this returns the pure
 * greeting + optional ", {name}" suffix.
 */
export function getGreeting(firstName: string | null): string {
  const period = bucketForHour(getISTHour());
  const safeName = sanitizeFirstName(firstName);
  if (!safeName) return PERIOD_COPY[period];
  return `${PERIOD_COPY[period]}, ${safeName}`;
}

function bucketForHour(hour: number): Period {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "hello"; // 22:00-04:59 — late night / early morning bucket
}

/**
 * Returns the current IST hour as 0..23. Uses Intl.DateTimeFormat with
 * `timeZone: 'Asia/Kolkata'` so the result is independent of the
 * process timezone (Netlify Functions run in UTC). Falls back to 0 on
 * the impossibly-pathological parse failure.
 */
function getISTHour(): number {
  const fmt = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    hour12: false,
  });
  const part = fmt.formatToParts(new Date()).find((p) => p.type === "hour");
  const parsed = part ? parseInt(part.value, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 23 ? parsed : 0;
}

/**
 * Extracts the first space-delimited word and truncates to
 * NAME_MAX_LENGTH characters. Returns "" for null / empty / whitespace-
 * only input so the greeting falls back to the nameless variant.
 *
 * Defensive: even if a full name gets passed (e.g. "Christopher Alexander"),
 * we keep only the first word — the greeting is a friendly first-name
 * surface, not a formal salutation.
 */
function sanitizeFirstName(input: string | null): string {
  if (!input) return "";
  const trimmed = input.trim();
  if (!trimmed) return "";
  const first = trimmed.split(/\s+/)[0];
  if (!first) return "";
  return first.length > NAME_MAX_LENGTH
    ? first.slice(0, NAME_MAX_LENGTH)
    : first;
}
