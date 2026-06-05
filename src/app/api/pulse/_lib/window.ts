import "server-only";

// Rolling-window parser shared by the trends + adherence routes. Accepts a
// small fixed vocabulary so the windows stay chart-friendly and cacheable.

const DAY = 24 * 60 * 60 * 1000;

const WINDOWS: Record<string, number> = {
  "7d": 7 * DAY,
  "14d": 14 * DAY,
  "30d": 30 * DAY,
  "90d": 90 * DAY,
  "180d": 180 * DAY,
  "1y": 365 * DAY,
};

/** Window string → milliseconds, or null if unrecognised. */
export function windowToMs(window: string | null | undefined): number | null {
  if (!window) return null;
  return WINDOWS[window] ?? null;
}
