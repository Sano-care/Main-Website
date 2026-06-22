// Slice 5b — CareHub outbound feature flags.
//
// BOTH default OFF: a send happens only when the env var is exactly "true"
// (any other value, including unset, means OFF). The founder flips these AFTER
// a founder-number smoke test — and, for the MARKETING offer, only after
// confirming the DPDP lawful basis (Q2). The visit-reminder template is also
// IN REVIEW at Meta, so its flag must stay OFF until the template is APPROVED.
//
// Centralised here so the flag names exist in exactly one place and tests can
// assert flag behaviour without string-duplicating the env keys.

export const CAREHUB_OFFER_FLAG = "WHATSAPP_CAREHUB_OFFER_ENABLED";
export const CAREHUB_VISIT_REMINDER_FLAG = "WHATSAPP_CAREHUB_VISIT_REMINDER_ENABLED";

export function isCarehubOfferEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[CAREHUB_OFFER_FLAG] === "true";
}

export function isCarehubVisitReminderEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[CAREHUB_VISIT_REMINDER_FLAG] === "true";
}
