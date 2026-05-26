-- supabase/migrations/025_medicine_catalog.sql
--
-- C2-Rx v7: medicine catalog for the Rx composer autocomplete.
--
-- Adds:
--   1. pg_trgm extension (idempotent).
--   2. public.medicine_catalog — one row per SKU from
--      "MEDICINES WITH COMPOSITIONS.csv" (854 rows in the source).
--      Doctor types brand or composition keyword → API ranks
--      matches via three indexes:
--        - prefix match on brand_name (ILIKE 'q%')
--        - trigram similarity on brand_name + composition (% operator)
--        - full-text on the generated search_vector
--   3. GIN indexes powering each strategy.
--   4. Open SELECT policy — the catalog is non-sensitive (public
--      brand+composition data). Insert/update/delete left service-
--      role-only (no policies), so the import script must use the
--      SUPABASE_SERVICE_ROLE_KEY.
--
-- The import script is at scripts/import_medicine_catalog.ts —
-- it's idempotent on the `sku` column via ON CONFLICT (sku)
-- DO UPDATE, so the founder can re-run it after CSV updates.
--
-- Idempotent. Safe to re-run.

BEGIN;

-- =====================================================================
-- 0. pg_trgm extension — MUST come before the trigram indexes below.
--    Idempotent via IF NOT EXISTS.
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =====================================================================
-- 1. medicine_catalog table
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.medicine_catalog (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Preserved from the source CSV for audit. Also the ON CONFLICT
  -- key in the import script, so the script can safely re-run.
  sku           integer UNIQUE,
  brand_name    text NOT NULL,
  strength      text,                       -- many rows in source empty
  form          text,                       -- Tablet/Capsule/Syrup/etc; ~6 empty rows in source
  pack_size     text,                       -- preserved; NOT surfaced in autocomplete UI
  category      text DEFAULT 'Medicine',
  composition   text NOT NULL,
  search_vector tsvector
                GENERATED ALWAYS AS (
                  setweight(to_tsvector('english', coalesce(brand_name, '')), 'A') ||
                  setweight(to_tsvector('english', coalesce(composition, '')), 'B') ||
                  setweight(to_tsvector('english', coalesce(strength, '')), 'C')
                ) STORED,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- 2. Indexes — one per ranking strategy used by the search API.
--    All idempotent.
-- =====================================================================
CREATE INDEX IF NOT EXISTS medicine_catalog_search_idx
  ON public.medicine_catalog USING gin (search_vector);

CREATE INDEX IF NOT EXISTS medicine_catalog_brand_trgm_idx
  ON public.medicine_catalog USING gin (brand_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS medicine_catalog_composition_trgm_idx
  ON public.medicine_catalog USING gin (composition gin_trgm_ops);

-- B-tree on the lowercase-of brand_name for fast ILIKE prefix
-- matches. (gin_trgm_ops handles the % similarity case but isn't
-- the fastest for prefix anchored queries; a plain B-tree on the
-- lowercase column is.)
CREATE INDEX IF NOT EXISTS medicine_catalog_brand_lower_idx
  ON public.medicine_catalog (lower(brand_name) text_pattern_ops);

-- =====================================================================
-- 3. RLS posture — open SELECT, no write policies.
--
--    The catalog is non-sensitive: brand names + compositions are
--    public knowledge (anyone can look up Crocin's composition).
--    The SELECT policy uses USING (true) so any role — including
--    the anon role — can read. Writes are intentionally NOT exposed
--    via policy; the import script runs with the service-role key
--    which bypasses RLS.
-- =====================================================================
ALTER TABLE public.medicine_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS medicine_catalog_select ON public.medicine_catalog;
CREATE POLICY medicine_catalog_select
  ON public.medicine_catalog
  FOR SELECT
  USING (true);

-- =====================================================================
-- 4. Sanity summary
-- =====================================================================
DO $$
DECLARE
  v_rows         integer;
  v_indexes      integer;
  v_pg_trgm      integer;
  v_policies     integer;
BEGIN
  SELECT count(*) INTO v_rows
    FROM public.medicine_catalog;
  SELECT count(*) INTO v_indexes
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'medicine_catalog';
  SELECT count(*) INTO v_pg_trgm
    FROM pg_extension
    WHERE extname = 'pg_trgm';
  SELECT count(*) INTO v_policies
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'medicine_catalog';

  RAISE NOTICE 'M025 sanity: medicine_catalog rows    = % (expect 0 pre-import)', v_rows;
  RAISE NOTICE 'M025 sanity: indexes (incl PK)        = % (expect 5)', v_indexes;
  RAISE NOTICE 'M025 sanity: pg_trgm extension        = % (expect 1)', v_pg_trgm;
  RAISE NOTICE 'M025 sanity: SELECT policies          = % (expect 1)', v_policies;
  RAISE NOTICE 'Migration 025 complete. Founder: run scripts/import_medicine_catalog.ts to populate.';
END $$;

COMMIT;
