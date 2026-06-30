-- Standardize marketing_leads money to PAISE. lifetime_value stored rupees while
-- spend + everything else is paise; Slice 2 worked around it with a ×100 in
-- attribution. Fix at source: rename to lifetime_value_paise (bigint), backfill
-- rupees→paise. Table is empty, so the backfill is trivial but kept for
-- correctness. End state: ONE paise column, no rupee column left.
ALTER TABLE public.marketing_leads RENAME COLUMN lifetime_value TO lifetime_value_paise;

-- Backfill any existing rupee values to paise (no-op on an empty table).
UPDATE public.marketing_leads
  SET lifetime_value_paise = round(lifetime_value_paise * 100)
  WHERE lifetime_value_paise <> 0;

ALTER TABLE public.marketing_leads
  ALTER COLUMN lifetime_value_paise TYPE bigint USING round(lifetime_value_paise)::bigint;
ALTER TABLE public.marketing_leads
  ALTER COLUMN lifetime_value_paise SET DEFAULT 0;
ALTER TABLE public.marketing_leads
  ALTER COLUMN lifetime_value_paise SET NOT NULL;

COMMENT ON COLUMN public.marketing_leads.lifetime_value_paise IS
  'Rolled-up booking value in PAISE (matches marketing_ad_spend.spend_paise).';
