-- Migration: OTP verifications + bookings.otp_verified_at link
-- Run this in the Supabase SQL Editor.
--
-- Phone-first booking gate. Patient verifies their phone via a 6-digit OTP
-- delivered over WhatsApp (Cloud API) or SMS (MSG91, deferred). The hash of
-- the code is stored in `otp_hash` — never the plaintext. The verify endpoint
-- compares hashes; on success it mints a short-lived signed cookie and the
-- booking-insert endpoints check the cookie before writing a row.

CREATE TABLE IF NOT EXISTS public.otp_verifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  otp_hash    text NOT NULL,
  channel     text NOT NULL CHECK (channel IN ('whatsapp', 'sms')),
  attempts    integer NOT NULL DEFAULT 0,
  verified_at timestamptz,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_phone_created_desc
  ON public.otp_verifications (phone, created_at DESC);

-- Lock the table down. Only the service role (used by /api/auth/* + booking
-- routes) should read/write. The anon role must NEVER see hashes or attempts.
ALTER TABLE public.otp_verifications ENABLE ROW LEVEL SECURITY;

-- No policies are added → anon + authenticated get zero access. The service
-- role bypasses RLS entirely, which is exactly what we want.

-- Link the verification to the booking it gated.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS otp_verified_at timestamptz;

-- Cleanup hook: anything older than 24h goes. Avoid retaining OTP data
-- beyond what's needed for fraud forensics / DPDP minimisation. This runs
-- opportunistically on each send (cheap on a small index) and is also safe
-- to schedule via pg_cron if/when we want it.
CREATE OR REPLACE FUNCTION public.purge_old_otp_verifications()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.otp_verifications
  WHERE created_at < now() - INTERVAL '24 hours';
$$;

COMMENT ON TABLE public.otp_verifications IS
  'Phone OTP records. Hashes only, never plaintext. Service-role access only.';
COMMENT ON COLUMN public.bookings.otp_verified_at IS
  'Set when the booking was created behind a verified-phone gate (BookingGate).';
