// Patient-view token utilities for /rx/<token>.
//
// Mirrors src/lib/consult/tokens.ts and src/lib/lab-tokens.ts in shape
// and intent: a 32-char URL-safe random token written onto the
// prescriptions.patient_view_token column at send-time, surfaced to the
// patient as https://sanocare.in/rx/<token> in the WhatsApp message.
//
// Token properties:
//   - 32 hex chars (128 bits of entropy) — unguessable
//   - URL-safe (only [0-9a-f])
//   - Bound to a single prescriptions row via the partial UNIQUE index
//     prescriptions_patient_view_token_unique (M023, WHERE
//     patient_view_token IS NOT NULL)
//   - Reusable indefinitely until the row is voided or superseded —
//     the patient should be able to re-open the link weeks later from
//     their WhatsApp history. Revocation = NULLing the column (which
//     is what supersede + void do, transitively, by changing the row's
//     status — the /rx/[token] route refuses non-'sent' rows).
//
// We deliberately do NOT use JWTs: a DB-backed token gives ops the
// option to revoke individual links by clearing the column without
// invalidating any signing secret. Same call as the consult and lab
// token paths.

import crypto from "crypto";

export function generateRxPatientViewToken(): string {
  return crypto.randomBytes(16).toString("hex"); // 32 hex chars
}

export function isValidRxPatientViewTokenFormat(
  token: unknown,
): token is string {
  return typeof token === "string" && /^[a-f0-9]{32}$/.test(token);
}
