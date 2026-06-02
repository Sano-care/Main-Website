-- Migration 033: DPDP consent ledger
-- Adds audit trail for cookie consent decisions on sanocare.in per DPDP
-- Act 2023. Every Accept All / Reject All / Save Preferences action
-- creates one row. Anonymous visitors are keyed by session_id (a
-- browser-generated UUID stored alongside the sano_consent cookie);
-- logged-in customers also have customer_id populated.
--
-- ip_hash is sha256(raw_ip || $CONSENT_IP_HASH_SALT) — never the raw
-- IP. Stored only for downstream abuse / bot-pattern review. The salt
-- is an env var; rotating it invalidates correlation across historical
-- rows, which is intentional.
--
-- No RLS policy attached — writes happen via the service-role client
-- inside POST /api/consent/record. Reads will be ops-only via a future
-- /ops surface (not in this PR).
--
-- apply_migration wraps its own transaction; do NOT add BEGIN/COMMIT
-- here. Same convention as M026-M032.

CREATE TABLE IF NOT EXISTS public.consent_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  session_id    text,
  analytics     boolean NOT NULL,
  marketing     boolean NOT NULL,
  user_agent    text,
  ip_hash       text,
  source        text NOT NULL DEFAULT 'banner'
                  CHECK (source IN ('banner', 'preferences_modal', 'footer_link')),
  recorded_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.consent_ledger IS
  'DPDP-compliant audit trail of cookie consent decisions on sanocare.in. '
  'One row per Accept / Reject / Save Preferences action. ip_hash is '
  'sha256(raw_ip || CONSENT_IP_HASH_SALT), never raw IP. customer_id is '
  'populated for logged-in patients; session_id keys anonymous visitors.';

COMMENT ON COLUMN public.consent_ledger.source IS
  'Which UI surface triggered the record. banner = first-load consent prompt; '
  'preferences_modal = explicit Save inside Manage Preferences; footer_link = '
  'reopened via the global Manage Cookies footer link.';

CREATE INDEX IF NOT EXISTS idx_consent_ledger_recorded_at
  ON public.consent_ledger (recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_consent_ledger_customer_id
  ON public.consent_ledger (customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_consent_ledger_session_id
  ON public.consent_ledger (session_id)
  WHERE session_id IS NOT NULL;

DO $$
DECLARE
  table_exists int;
  index_count int;
BEGIN
  SELECT count(*) INTO table_exists
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'consent_ledger';
  SELECT count(*) INTO index_count
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'consent_ledger';
  RAISE NOTICE 'consent_ledger present=% indexes=% (expected 1 / 4 — pkey + 3 explicit)',
    table_exists, index_count;
END $$;
