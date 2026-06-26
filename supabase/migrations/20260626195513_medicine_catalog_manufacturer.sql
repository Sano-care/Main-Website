-- 1mg dataset enrichment: capture the manufacturer column the import carries.
-- Additive + nullable; existing 854 seed rows keep manufacturer NULL.
ALTER TABLE public.medicine_catalog ADD COLUMN IF NOT EXISTS manufacturer text;

COMMENT ON COLUMN public.medicine_catalog.manufacturer IS
  'Marketing company / manufacturer. Populated for source=dataset_1mg rows; NULL for curated seed rows.';
