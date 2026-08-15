// Pulse launch gate — the site holds the app download until this instant.
//
// Fixed absolute target: 4:30 PM IST on 2026-08-15 (Asia/Kolkata, +05:30). It's
// an absolute epoch, so client and server agree on the exact flip moment
// regardless of the viewer's timezone or a fiddled local clock's wall-time.

export const LAUNCH_TARGET_ISO = "2026-08-15T16:30:00+05:30";
export const LAUNCH_TARGET_MS = new Date(LAUNCH_TARGET_ISO).getTime();

/** Whole seconds left until the target (0 once reached — never negative). */
export function remainingSecondsAt(targetMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
}

export interface CountdownParts {
  hh: number;
  mm: number;
  ss: number;
  /** true once the countdown has hit zero (launched). */
  launched: boolean;
}

/** Split a remaining-seconds count into Hrs:Min:Sec + the launched flag. */
export function countdownParts(remainingSeconds: number): CountdownParts {
  const s = Math.max(0, Math.floor(remainingSeconds));
  return {
    hh: Math.floor(s / 3600),
    mm: Math.floor((s % 3600) / 60),
    ss: s % 60,
    launched: s === 0,
  };
}

/** Zero-padded 2-digit string ("07"). */
export function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, "0");
}
