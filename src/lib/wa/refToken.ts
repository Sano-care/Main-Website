// Pure (no DB, no server-only) helpers for the `[ref: SC-XXXXXX]` WhatsApp
// click-attribution handle. Kept separate from clickToken.ts so the inbound
// normalization boundary (src/types/whatsapp.ts) can extract + strip the token
// without pulling in the server-only Supabase client that mint/resolve need.

export const WA_REF_PREFIX = "SC-";

/**
 * Matches `[ref: SC-XXXXXX]` tolerantly — any case, optional inner whitespace.
 * Patients forward/retype messages, so be generous about what we accept.
 * Crockford base32 body (no I/L/O/U).
 */
export const WA_REF_RE = /\[\s*ref\s*:\s*(SC-[0-9A-HJKMNP-TV-Z]{6})\s*\]/i;

/** Pull the ref token out of an inbound message body. Null when absent. */
export function extractWaRefToken(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = WA_REF_RE.exec(text);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Remove the `[ref: …]` fragment from a message body so it is never stored,
 * shown in /ops, or seen by the agent. Collapses the whitespace the removal
 * leaves behind (the token is normally a trailing ` [ref: …]`, but a forwarded
 * message can carry it mid-string). Returns "" for null/empty input.
 */
export function stripWaRef(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(WA_REF_RE, " ").replace(/\s{2,}/g, " ").trim();
}

/** The suffix appended to a WhatsApp prefill message. */
export function buildWaRefSuffix(token: string): string {
  return ` [ref: ${token}]`;
}
