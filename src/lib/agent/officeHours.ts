// Aarogya office-hours awareness (correctness hotfix).
//
// Sanocare's care team operates 09:00–21:00 IST. Aarogya had no runtime clock,
// so it promised on-demand SLAs (30-min medic / 15-min doctor) at any hour —
// including 03:30 AM. This is the single source of truth for "are we open?".
//
// Boundaries: OPEN is [09:00, 21:00) IST — 9 AM inclusive, 9 PM exclusive.

import { istHour } from "@/lib/time/formatIST";

export const OPEN_HOUR_IST = 9; // 09:00 — first hour open
export const CLOSE_HOUR_IST = 21; // 21:00 — first hour closed

/** True when `date` falls within Sanocare office hours (09:00–21:00 IST). */
export function isSanocareOpen(date: Date): boolean {
  const h = istHour(date);
  return h !== null && h >= OPEN_HOUR_IST && h < CLOSE_HOUR_IST;
}

export const OFFICE_HOURS_LABEL = "9 AM–9 PM IST";
