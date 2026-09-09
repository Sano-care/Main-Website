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

// A SEPARATE global instance for stripping. Deliberately NOT the `g` flag on
// WA_REF_RE itself: that regex is used with `.exec()` in extractWaRefToken, and
// a global regex carries `lastIndex` state across calls, which would make
// extraction intermittently return null. `String.replace` with a global regex
// resets lastIndex on entry, so this instance is safe to reuse for strip only.
const WA_REF_RE_GLOBAL = new RegExp(WA_REF_RE.source, "gi");

/** Pull the (first) ref token out of an inbound message body. Null when absent. */
export function extractWaRefToken(text: string | null | undefined): string | null {
  if (!text) return null;
  // WA_REF_RE is non-global → `.exec` always matches from the start, no
  // lastIndex state, safe to call repeatedly on the same input.
  const match = WA_REF_RE.exec(text);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Remove EVERY `[ref: …]` fragment from a message body so it is never stored,
 * shown in /ops, or seen by the agent. A forwarded message can carry more than
 * one (an old message already containing a ref + the sender's own appended
 * ref), so this strips all occurrences, not just the first. Collapses the
 * whitespace the removal leaves behind. Returns "" for null/empty input.
 */
export function stripWaRef(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(WA_REF_RE_GLOBAL, " ").replace(/\s{2,}/g, " ").trim();
}

/** The suffix appended to a WhatsApp prefill message. */
export function buildWaRefSuffix(token: string): string {
  return ` [ref: ${token}]`;
}
