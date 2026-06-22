"use client";

import { usePresenceHeartbeat } from "@/lib/realtime/usePresenceHeartbeat";

/**
 * Headless presence pinger mounted once in the doctor (shell) layout, so
 * presence accrues across the whole authenticated doctor portal — not just
 * the Duty Room embed. This matches the C3 "first-login-of-day" model: a
 * salaried doctor is on shift (and earning the daily wage) for being logged
 * in and available, between patients as well as during calls. Mounted for
 * every doctor; the M063 bridge only auto-marks salaried ones — freelancers
 * are logged for hours visibility but never marked.
 *
 * Renders nothing.
 */
export function PresenceHeartbeat() {
  usePresenceHeartbeat();
  return null;
}
