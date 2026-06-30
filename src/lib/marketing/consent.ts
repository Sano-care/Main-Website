// THE consent gate. Aarogya may only be enqueued for an opted-in lead
// (WABA-ban + DPDP). This is the single code-side guard; the DB also enforces
// it via the marketing_leads_aarogya_consent_check CHECK constraint (so a
// non-opted-in enqueue is impossible even if a caller forgets this guard).

import type { ConsentStatus } from "./types";

/** True iff this lead may be enqueued for an Aarogya nurture send. */
export function canEnqueueAarogya(lead: { consent_status: ConsentStatus }): boolean {
  return lead.consent_status === "opted_in";
}
