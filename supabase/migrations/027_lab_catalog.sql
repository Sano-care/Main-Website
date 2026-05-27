-- 027_lab_catalog.sql
--
-- C2-Rx lab catalog hotfix: bolt-on to v3 that wires lab-test
-- autocomplete in the Rx composer's Investigations Advised section.
-- Same pattern as M025 (medicine_catalog): DB-backed catalog + trigram
-- search endpoint + autocomplete component + wire-in to both
-- composers. Applied to prod via Supabase MCP `apply_migration` on
-- 2026-05-27 (schema_migrations.version=20260527145424).
--
-- BEGIN/COMMIT stripped per founder note: `apply_migration` wraps its
-- own tx; double-wrapping just adds the two "transaction in progress"
-- WARNING lines without any safety gain. For direct `psql -f` re-runs
-- the only DDL guard is IF NOT EXISTS / IF EXISTS, which is already
-- pervasive in this file.
--
-- Changes:
--   1. lab_tests catalog table (Pathcore source — 1,900 rows imported
--      separately via scripts/import_lab_tests.ts)
--   2. tsvector + trigram + prefix indexes (same shape as
--      medicine_catalog's search posture)
--   3. RLS open SELECT + service-role-only writes (no INSERT/UPDATE/
--      DELETE policy = denied for anon + authenticated)
--   4. prescription_lab_tests.lab_test_id nullable FK -> lab_tests(id)
--      ON DELETE SET NULL — preserves history if a catalog row ever
--      gets removed
--   5. Partial index on lab_test_id (only the catalog-linked rows
--      matter for joined reads; free-text rows skip this lookup path)

-- ===== 1) lab_tests catalog =====
CREATE TABLE IF NOT EXISTS public.lab_tests (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text        UNIQUE NOT NULL,           -- Pathcore code (e.g. BC0573)
  name          text        NOT NULL,
  category      text,                                  -- Routine, Specialised, Oncology, ...
  method        text,                                  -- CLIA, ELISA, FISH, ...
  sample        text,                                  -- "3 mL Serum (Red Top)"
  tat           text,                                  -- "3 days"
  shipping      text,                                  -- "Ship refrigerated"
  price_paise   integer,                               -- price_rupees * 100; source field is rupees
  utility       text,                                  -- clinical description
  instructions  text,                                  -- "Clinical history is mandatory"
  search_vector tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(name, '')),     'A') ||
      setweight(to_tsvector('english', coalesce(code, '')),     'B') ||
      setweight(to_tsvector('english', coalesce(category, '')), 'C') ||
      setweight(to_tsvector('english', coalesce(utility, '')),  'D')
    ) STORED,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- pg_trgm is already installed via M025 (medicine_catalog uses it). The
-- IF NOT EXISTS keeps this idempotent in case the migration is re-run
-- against a fresh shadow database.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_lab_tests_search_vector
  ON public.lab_tests USING gin (search_vector);
CREATE INDEX IF NOT EXISTS idx_lab_tests_name_trgm
  ON public.lab_tests USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_lab_tests_code_trgm
  ON public.lab_tests USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_lab_tests_name_prefix
  ON public.lab_tests (lower(name) text_pattern_ops);

-- Open SELECT (doctor + ops + service-role all read). Writes are
-- service-role-only because no INSERT/UPDATE/DELETE policy exists,
-- which RLS treats as "denied for anon + authenticated". Same posture
-- as medicine_catalog (M025).
ALTER TABLE public.lab_tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_tests_open_select ON public.lab_tests;
CREATE POLICY lab_tests_open_select
  ON public.lab_tests FOR SELECT USING (true);

-- ===== 2) prescription_lab_tests -> lab_tests FK (nullable) =====
ALTER TABLE public.prescription_lab_tests
  ADD COLUMN IF NOT EXISTS lab_test_id uuid
    REFERENCES public.lab_tests(id) ON DELETE SET NULL;

-- Partial index: only the catalog-linked rows matter for joined reads;
-- free-text rows (lab_test_id IS NULL) never hit this lookup path.
CREATE INDEX IF NOT EXISTS idx_rx_lab_tests_lab_test_id
  ON public.prescription_lab_tests(lab_test_id)
  WHERE lab_test_id IS NOT NULL;

-- ===== 3) Post-state sanity (single % per RAISE NOTICE -- M022 lesson) =====
DO $$
DECLARE
  v_catalog_rows int;
  v_rx_with_fk   int;
BEGIN
  SELECT count(*) INTO v_catalog_rows FROM public.lab_tests;
  SELECT count(*) INTO v_rx_with_fk
    FROM public.prescription_lab_tests WHERE lab_test_id IS NOT NULL;

  RAISE NOTICE 'M027: lab_tests rows = %',                        v_catalog_rows;
  RAISE NOTICE 'M027: prescription_lab_tests w/ lab_test_id = %', v_rx_with_fk;
END $$;
