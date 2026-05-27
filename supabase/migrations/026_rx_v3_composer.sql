-- 026_rx_v3_composer.sql
--
-- C2-Rx v3: schema deltas to support the redesigned prescription template +
-- in-call composer drawer. Applied to prod via Supabase MCP `apply_migration`
-- on 2026-05-27 (schema_migrations.version=20260527010609).
--
-- This file mirrors the SQL that landed in the database so the repo stays a
-- source-of-truth audit trail alongside Supabase's internal schema_migrations.
--
-- Changes:
--   1. doctors.stamp_image_url   — signed-URL path for optional rubber-stamp PNG
--   2. doctors.issuing_council   — text of regulatory body issuing reg_no
--                                  (idempotent backfill for Dr Sanskriti)
--   3. prescriptions.{bp_sys,bp_dia,pulse_bpm,spo2_pct,temp_c,height_cm}
--                                — six nullable vitals fields with bounded CHECKs
--   4. prescription_items.medicine_sku  — nullable FK → medicine_catalog(sku),
--                                  ON DELETE SET NULL so historical Rx items
--                                  survive catalog removals
--   5. prescription_lab_tests    — new sub-table for "Investigations Advised"
--                                  rows; free-text test_name (a phase-2 catalog
--                                  FK can be added later without breaking rows);
--                                  `ordinal` column name matches the sibling
--                                  prescription_items table (M023 convention)
--
-- A1 enforcement: prescription_lab_tests gets ops-only RLS policies via
-- public.is_ops_user(). Doctor-side reads/writes go through service-role
-- accessors with doctor_id verified from the cookie session, never from
-- form data (same pattern as prescriptions / prescription_items).

-- NOTE: The connector wraps `apply_migration` in its own BEGIN/COMMIT, so the
-- outer wrapper below is redundant when applied via MCP. Kept for parity with
-- the M025 file and for direct `psql -f` re-runs.

BEGIN;

-- 1) Doctor identity extensions (stamp image + issuing council).
ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS stamp_image_url  text;
ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS issuing_council  text;

-- Seed founder doctor's issuing council (idempotent: only if NULL).
UPDATE public.doctors
   SET issuing_council = 'U.P. Medical Council'
 WHERE registration_no = '131849'
   AND issuing_council IS NULL;

-- 2) Prescription vitals (6 fields, all nullable, all bounded).
ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS bp_sys     int          CHECK (bp_sys     IS NULL OR bp_sys     BETWEEN 50 AND 250),
  ADD COLUMN IF NOT EXISTS bp_dia     int          CHECK (bp_dia     IS NULL OR bp_dia     BETWEEN 30 AND 160),
  ADD COLUMN IF NOT EXISTS pulse_bpm  int          CHECK (pulse_bpm  IS NULL OR pulse_bpm  BETWEEN 30 AND 220),
  ADD COLUMN IF NOT EXISTS spo2_pct   int          CHECK (spo2_pct   IS NULL OR spo2_pct   BETWEEN 50 AND 100),
  ADD COLUMN IF NOT EXISTS temp_c     numeric(4,1) CHECK (temp_c     IS NULL OR temp_c     BETWEEN 30 AND 45),
  ADD COLUMN IF NOT EXISTS height_cm  numeric(5,1) CHECK (height_cm  IS NULL OR height_cm  BETWEEN 30 AND 250);

-- 3) Medicine FK on prescription_items (nullable; preserves free-text rows).
ALTER TABLE public.prescription_items
  ADD COLUMN IF NOT EXISTS medicine_sku int
    REFERENCES public.medicine_catalog(sku) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rx_items_medicine_sku
  ON public.prescription_items(medicine_sku)
  WHERE medicine_sku IS NOT NULL;

-- 4) Lab tests sub-table (free-text for v3; phase-2 can add a catalog FK).
--    `ordinal` matches prescription_items naming (M023 sibling).
CREATE TABLE IF NOT EXISTS public.prescription_lab_tests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  ordinal         int  NOT NULL CHECK (ordinal >= 1),
  test_name       text NOT NULL,
  instructions    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prescription_lab_tests_ordinal_unique UNIQUE (prescription_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_rx_lab_tests_rx
  ON public.prescription_lab_tests(prescription_id);

ALTER TABLE public.prescription_lab_tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prescription_lab_tests_ops_select ON public.prescription_lab_tests;
DROP POLICY IF EXISTS prescription_lab_tests_ops_insert ON public.prescription_lab_tests;
DROP POLICY IF EXISTS prescription_lab_tests_ops_update ON public.prescription_lab_tests;
DROP POLICY IF EXISTS prescription_lab_tests_ops_delete ON public.prescription_lab_tests;

CREATE POLICY prescription_lab_tests_ops_select
  ON public.prescription_lab_tests FOR SELECT
  USING (public.is_ops_user());

CREATE POLICY prescription_lab_tests_ops_insert
  ON public.prescription_lab_tests FOR INSERT
  WITH CHECK (public.is_ops_user());

CREATE POLICY prescription_lab_tests_ops_update
  ON public.prescription_lab_tests FOR UPDATE
  USING (public.is_ops_user())
  WITH CHECK (public.is_ops_user());

CREATE POLICY prescription_lab_tests_ops_delete
  ON public.prescription_lab_tests FOR DELETE
  USING (public.is_ops_user());

-- 5) Post-state sanity (single % in format strings — M022 lesson).
DO $$
DECLARE
  v_d_stamp    int;
  v_d_council  int;
  v_rx_vital   int;
  v_items_sku  int;
  v_lab_rows   int;
BEGIN
  SELECT count(*) INTO v_d_stamp
    FROM public.doctors WHERE stamp_image_url IS NOT NULL;

  SELECT count(*) INTO v_d_council
    FROM public.doctors WHERE issuing_council IS NOT NULL;

  SELECT count(*) INTO v_rx_vital
    FROM public.prescriptions
   WHERE bp_sys IS NOT NULL OR pulse_bpm IS NOT NULL OR temp_c IS NOT NULL;

  SELECT count(*) INTO v_items_sku
    FROM public.prescription_items WHERE medicine_sku IS NOT NULL;

  SELECT count(*) INTO v_lab_rows
    FROM public.prescription_lab_tests;

  RAISE NOTICE 'M026: doctors w/ stamp = %  w/ council = %', v_d_stamp, v_d_council;
  RAISE NOTICE 'M026: prescriptions w/ vitals = %',          v_rx_vital;
  RAISE NOTICE 'M026: prescription_items w/ medicine_sku = %', v_items_sku;
  RAISE NOTICE 'M026: prescription_lab_tests rows = %',      v_lab_rows;
END $$;

COMMIT;
