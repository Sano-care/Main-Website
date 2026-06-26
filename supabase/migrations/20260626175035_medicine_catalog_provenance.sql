-- Medicine resolver: provenance + review columns so Aarogya can grow the
-- catalogue from web-verified / strip-read entries while keeping unverified
-- rows OUT of the doctor prescriber search until ops approves them.
ALTER TABLE public.medicine_catalog
  ADD COLUMN source text NOT NULL DEFAULT 'seed',           -- 'seed' | 'aarogya_web' | 'aarogya_strip'
  ADD COLUMN review_status text NOT NULL DEFAULT 'approved',-- existing 854 → approved; auto-adds → pending
  ADD COLUMN added_by_customer_id uuid NULL REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN verified_source text NULL;                     -- citation URL or 'strip_photo'

ALTER TABLE public.medicine_catalog
  ADD CONSTRAINT medicine_catalog_review_status_chk
  CHECK (review_status IN ('approved', 'pending', 'rejected'));

-- Ops review list — only pending rows.
CREATE INDEX idx_medicine_catalog_pending
  ON public.medicine_catalog (created_at)
  WHERE review_status = 'pending';

-- Typo-tolerant resolver. brand_name carries pack/form suffixes
-- ("Shelgut Capsule 10's"), so full-string similarity() is too diluted —
-- word_similarity() (best contiguous word-extent match) is the right metric.
-- Returns approved candidates ranked by a normalised 0..1 score; the executor
-- applies confidence bands (confirm single vs show top-3 vs fall to web/photo).
CREATE OR REPLACE FUNCTION public.resolve_medicine_catalog(q text, max_n int DEFAULT 5)
RETURNS TABLE (
  id uuid,
  brand_name text,
  strength text,
  form text,
  composition text,
  score real
)
LANGUAGE sql STABLE
AS $$
  SELECT id, brand_name, strength, form, composition,
    GREATEST(
      CASE WHEN brand_name ILIKE q || '%' THEN 1.0 ELSE 0 END,
      word_similarity(q, brand_name),
      word_similarity(q, composition) * 0.7
    )::real AS score
  FROM public.medicine_catalog
  WHERE review_status = 'approved'
    AND (
      brand_name ILIKE q || '%'
      OR word_similarity(q, brand_name) > 0.3
      OR word_similarity(q, composition) > 0.35
    )
  ORDER BY score DESC, brand_name ASC
  LIMIT GREATEST(1, LEAST(max_n, 10));
$$;
