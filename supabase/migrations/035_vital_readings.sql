-- Migration 035: Patient vital readings (BP, sugar, weight, etc.)
-- One row per individual reading. Patient self-reports via /pulse/vitals,
-- or auto-imported (future) from device integrations.
--
-- value_numeric is the primary measurement; value_secondary covers BP
-- (systolic = value_numeric, diastolic = value_secondary). For all other
-- kinds, value_secondary is NULL.
--
-- "kind" is constrained to a known enum so charting code can rely on it.
--
-- T62 correction: brief referenced patients(id) — that table does not
-- exist. Same FK target as M033 consent_ledger and M034 callback_requests:
-- public.customers(id) ON DELETE CASCADE.
--
-- T62 naming: surface is "Sanocare Pulse" — patient_portal terminology
-- is deprecated. Schema is naming-neutral; only UI / route paths carry
-- the new brand.
--
-- apply_migration wraps its own transaction; do NOT add BEGIN/COMMIT.
-- Same convention as M026-M034.

CREATE TABLE IF NOT EXISTS public.vital_readings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN (
                    'bp',
                    'sugar_fasting',
                    'sugar_postprandial',
                    'sugar_random',
                    'weight_kg',
                    'temperature_c',
                    'spo2_pct',
                    'pulse_bpm',
                    'other'
                  )),
  value_numeric   numeric NOT NULL,
  value_secondary numeric,
  unit            text NOT NULL DEFAULT 'auto',
  taken_at        timestamptz NOT NULL,
  context_note    text,
  source          text NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual', 'rx_import', 'device')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vital_readings_customer_taken_at
  ON public.vital_readings (customer_id, taken_at DESC);

CREATE INDEX IF NOT EXISTS idx_vital_readings_customer_kind_taken_at
  ON public.vital_readings (customer_id, kind, taken_at DESC);

COMMENT ON TABLE public.vital_readings IS
  'Patient-logged vital signs (BP, sugar, weight, etc.). One row per reading. '
  'customer_id matches the M033/M034 FK convention — there is no patients table.';

DO $$
DECLARE
  table_exists int;
  index_count int;
  column_count int;
BEGIN
  SELECT count(*) INTO table_exists FROM information_schema.tables WHERE table_schema='public' AND table_name='vital_readings';
  SELECT count(*) INTO index_count FROM pg_indexes WHERE schemaname='public' AND tablename='vital_readings';
  SELECT count(*) INTO column_count FROM information_schema.columns WHERE table_schema='public' AND table_name='vital_readings';
  RAISE NOTICE 'vital_readings present=% indexes=% columns=% (expected 1 / 3 / 10)', table_exists, index_count, column_count;
END $$;
