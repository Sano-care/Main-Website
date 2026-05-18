// Lab report magic-link token utilities (server-side only).
//
// When ops marks a lab report ready, we generate a 32-char URL-safe random
// token, store it on the booking row, and send the patient a link of the
// form https://sanocare.in/reports/<token>. The /reports/[token] page uses
// this token to look up the booking, gate the report download on payment,
// and serve the report PDF via a signed Supabase Storage URL.
//
// Token properties:
//   - 32 hex chars (128 bits of entropy) — unguessable
//   - URL-safe (only [0-9a-f])
//   - Bound to a single booking row via UNIQUE constraint
//   - Persisted; can be revoked by setting the column to NULL
//
// We deliberately do NOT use signed JWTs here: a long-lived database-backed
// token gives ops the ability to revoke individual tokens by zeroing the
// column, which is easier to reason about for support tickets.

import crypto from "crypto";

export function generateReportUnlockToken(): string {
  return crypto.randomBytes(16).toString("hex"); // 32 hex chars
}

export function isValidTokenFormat(token: unknown): token is string {
  return typeof token === "string" && /^[a-f0-9]{32}$/.test(token);
}
