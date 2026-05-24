// Consultation join-link token utilities (server-side only).
//
// Mirrors src/lib/lab-tokens.ts. When a teleconsultation booking is
// created, we mint a 32-char URL-safe random token, write it onto the
// consultation_participants row for the patient, and send the patient
// a WhatsApp link of the form https://sanocare.in/c/<token>. The
// /c/[token] page resolves the token via the service-role client to
// the participant -> session -> doctor chain and renders the patient
// join page.
//
// Token properties:
//   - 32 hex chars (128 bits of entropy) — unguessable
//   - URL-safe (only [0-9a-f])
//   - Bound to a single consultation_participants row via UNIQUE partial
//     index (consultation_participants_token_unique, M021)
//   - Reusable until consultation_participants.join_token_expires_at
//     (so the patient can re-tap their WhatsApp link after a network
//     hiccup) — NOT consumed on use. joined_at tracks the first click
//     for audit; subsequent clicks update nothing.
//
// We deliberately do NOT use signed JWTs here: a long-lived
// database-backed token gives ops the ability to revoke individual
// tokens by zeroing the column, which is easier to reason about for
// support tickets — same call as lab-tokens.

import crypto from "crypto";

/** Same shape and entropy as bookings.report_unlock_token (M008). */
export function generateConsultJoinToken(): string {
  return crypto.randomBytes(16).toString("hex"); // 32 hex chars
}

export function isValidConsultJoinTokenFormat(token: unknown): token is string {
  return typeof token === "string" && /^[a-f0-9]{32}$/.test(token);
}

/**
 * Default expiry for a freshly minted join token: 24 hours after the
 * scheduled consultation time (or 24 hours after now if there's no
 * scheduled time). Generous so a patient who taps their link a few
 * hours after the consult still gets a clear "session ended / expired"
 * surface rather than a 404.
 */
export function defaultJoinTokenExpiry(scheduledAt: Date | string | null): Date {
  const base = scheduledAt ? new Date(scheduledAt) : new Date();
  return new Date(base.getTime() + 24 * 60 * 60 * 1000);
}
