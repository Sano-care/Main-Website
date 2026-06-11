-- M047: pulse_first_signin_tracking
--
-- Adds a single nullable timestamp to customers so the verify-otp handler can
-- distinguish "first Pulse signin" from "first customers row creation".
--
-- Why this matters: the customers row may have been auto-upserted long before
-- the patient ever signs into Pulse (e.g., via the booking auto-upsert path
-- from customer-link-hotpatch-v1, or via ops manual entry). Without this
-- column, those existing-customer + new-to-Pulse users would skip the
-- onboarding flow — losing the DPDP-required stay-signed-in consent UI and
-- the highest-leverage engagement moment (family-add prompt).
--
-- Detection in /api/auth/verify-otp success path:
--   const isFirstPulseSignin = customer.pulse_first_signin_at === null;
--   if (isFirstPulseSignin) {
--     // stamp + return is_new_customer: true
--   }
--
-- All existing customer rows (~7 in prod as of 2026-06-11) start with NULL,
-- so they correctly read as new-to-Pulse on their next signin.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS pulse_first_signin_at TIMESTAMPTZ;

COMMENT ON COLUMN customers.pulse_first_signin_at IS
  'Timestamp of first Pulse OTP-verify success. NULL = user has not yet signed into Pulse. Used to gate the Pulse v1 onboarding flow.';
