// T90 Pulse v1 Phase 1 — session counter.
//
// localStorage-backed counter for /pulse home visits. Drives:
//   1. The emergency ribbon's disclaimer ("Sanocare provides planned
//      care, not emergency services") — shown on sessions 1-3 only,
//      hidden from session 4+ once the user has internalised the
//      message.
//   2. (Future) the PWA install prompt eligibility — only shown from
//      session 2 onward per brief Surface 7.
//
// Plan-gate decision (founder, Step 01): localStorage, NOT sessionStorage.
// Persists across tab/browser closes so the disclaimer fade-out is
// driven by genuine repeat-engagement, not by reopening tabs.
//
// Debounce: a quick back-forward navigation re-mounts the home page —
// we don't want that to bump the counter (founder Step-10 spec:
// "debounced so a quick back-forward doesn't double-bump"). We
// timestamp every bump and skip if it's been less than DEBOUNCE_MS
// since the last one. 60 seconds covers typical back-forward + tab
// switches; longer absences register as new sessions.

const COUNT_KEY = "pulse_sessions_count";
const LAST_BUMP_KEY = "pulse_sessions_last_bump_at";
const DEBOUNCE_MS = 60_000;

/**
 * Increment the home-session counter (debounced) and return the new
 * count. Safe to call from useEffect on every /pulse mount —
 * back-forward navigations within 60s of the last bump return the
 * existing count without bumping.
 *
 * Returns 0 in SSR / non-browser environments and on localStorage
 * exceptions (private browsing, security policies, quota errors).
 */
export function incrementSessionCount(): number {
  if (typeof window === "undefined") return 0;
  try {
    const now = Date.now();
    const lastBump = readInt(LAST_BUMP_KEY);
    const currentCount = readInt(COUNT_KEY);
    if (lastBump > 0 && now - lastBump < DEBOUNCE_MS) {
      // Within debounce window — no bump, return the existing count.
      return currentCount;
    }
    const newCount = currentCount + 1;
    window.localStorage.setItem(COUNT_KEY, String(newCount));
    window.localStorage.setItem(LAST_BUMP_KEY, String(now));
    return newCount;
  } catch (err) {
    // localStorage unavailable / quota / etc. Silent fall-through —
    // the disclaimer will show indefinitely, which is the safer UX
    // failure mode (over-show beats under-show for safety messaging).
    if (process.env.NODE_ENV !== "production") {
      console.warn("[sessionCount] increment failed", err);
    }
    return 0;
  }
}

/**
 * Read-only access to the current session count. Returns 0 in SSR
 * and on localStorage exceptions.
 */
export function getSessionCount(): number {
  if (typeof window === "undefined") return 0;
  try {
    return readInt(COUNT_KEY);
  } catch {
    return 0;
  }
}

function readInt(key: string): number {
  const raw = window.localStorage.getItem(key);
  if (!raw) return 0;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
