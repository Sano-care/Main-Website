// Slice 4a — Single-source constants for the WhatsApp/Aarogya pipeline.
//
// FOUNDER_OPS_PHONE is the founder's personal WhatsApp number that doubles
// as the ops alert destination (aarogya_lead_alert template target) AND the
// "ops mode" identity trigger (resolveIdentity returns role: "ops_founder"
// when an inbound matches). Frozen here so future renames are one-grep.
//
// Why a constant and not the env var? The old MY_PERSONAL_WHATSAPP env var
// is fine for local override but the prod truth lives in code — the founder
// owns this number and ops mode behavior is gated on it, so leaving the
// gate keyed off an env value would be a footgun if the env got mis-set.
// Adapter still reads the env var as an override path; constants.ts is the
// fallback / source of truth.

/** Founder's WhatsApp number (E.164). Source of truth for ops-mode routing
 *  and the aarogya_lead_alert template destination. */
export const FOUNDER_OPS_PHONE = "+919760059900";

/** Same number, digits-only — the form sendTemplateMessage / Meta Cloud
 *  API expects in the `to` field. Derived from FOUNDER_OPS_PHONE; never
 *  diverge. */
export const FOUNDER_OPS_PHONE_DIGITS = "919760059900";
