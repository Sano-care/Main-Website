-- GDA onboarding schema (founder-approved 2026-06-23).
--
-- A GDA needs NO qualification and is paid a DAILY wage by shift kind. Capture
-- home address, shift preference, per-GDA default shift-kind rates, and an
-- onboarding documents-consent timestamp. Aadhaar/PAN/photo/address_proof are
-- stored as IMAGES in the private medic-documents bucket (RLS-hardened in the
-- prior migration) — the raw ID NUMBER is never stored as queryable text.
--
-- Retention (founder/legal to confirm window): document images are retained while
-- the medic is active and purged 90 days after deactivation (active=false). The
-- purge job is out of this migration; documented here as the policy of record.
--
-- Applied via MCP (recorded version 20260624063154; filename matches).
--
-- Reversibility: drop the added columns; re-add NOT NULL to qualification only
-- AFTER backfilling any NULL GDA rows.

ALTER TABLE public.medics
  ALTER COLUMN qualification DROP NOT NULL;  -- GDAs have none; nurses still required via the form

ALTER TABLE public.medics
  ADD COLUMN IF NOT EXISTS home_address text,
  ADD COLUMN IF NOT EXISTS shift_preference text
    CHECK (shift_preference IN ('day12','night12','full24','any')),
  ADD COLUMN IF NOT EXISTS documents_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS rate_day12_paise integer
    CHECK (rate_day12_paise IS NULL OR rate_day12_paise >= 0),
  ADD COLUMN IF NOT EXISTS rate_night12_paise integer
    CHECK (rate_night12_paise IS NULL OR rate_night12_paise >= 0),
  ADD COLUMN IF NOT EXISTS rate_full24_paise integer
    CHECK (rate_full24_paise IS NULL OR rate_full24_paise >= 0);

COMMENT ON COLUMN public.medics.home_address IS 'GDA current/home address captured at onboarding.';
COMMENT ON COLUMN public.medics.shift_preference IS 'GDA preferred shift kind: day12|night12|full24|any. Assignment honors this.';
COMMENT ON COLUMN public.medics.documents_consent_at IS 'When the GDA consented to storing their ID documents at onboarding (DPDP).';
COMMENT ON COLUMN public.medics.rate_day12_paise IS 'Per-GDA default daily wage for a 12h day shift (paise); populates gda_shifts.payout_paise, overridable per shift.';
