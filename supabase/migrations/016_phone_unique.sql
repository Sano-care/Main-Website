-- Migration 016 — Canonicalise customer phones, merge duplicates, UNIQUE
--
-- Customer phones have accumulated in inconsistent formats: the OTP-gated
-- public booking flow already stores phones as E.164 ('+91XXXXXXXXXX'),
-- but ops-created customers (M1 createCustomer, M2.6 createBooking) wrote
-- whatever was typed. This migration:
--
--   1. Adds a SQL helper public.normalise_indian_phone(text) that converts
--      any reasonable Indian-phone input to E.164. Mirrors the JS
--      normaliseIndianPhone() in src/lib/otp/token.ts so DB + app agree.
--   2. Normalises every existing customers.phone to E.164 where possible.
--      Inputs that can't be normalised (foreign numbers, garbage) are left
--      untouched so the migration can't silently destroy data.
--   3. Merges duplicate customers sharing the same (now-normalised) phone.
--      Per duplicate group: keep the oldest row (lowest created_at),
--      repoint every bookings.customer_id from the losers onto the keeper,
--      then DELETE the losers. Emits a NOTICE with the count merged.
--   4. Adds a UNIQUE index on customers.phone (replacing the M1 non-unique
--      idx_customers_phone). NULL phones are allowed by UNIQUE.
--
-- Canonical format choice: E.164 '+91XXXXXXXXXX' — matches the public
-- booking flow's existing storage on bookings.phone, so customer↔booking
-- joins by phone remain consistent.
--
-- Idempotent: safe to re-run.

-- =====================================================================
-- normalise_indian_phone(text) — SQL twin of src/lib/otp/token.ts
-- =====================================================================
CREATE OR REPLACE FUNCTION public.normalise_indian_phone(p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  digits text;
  local_part text;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;

  digits := regexp_replace(p, '\D', '', 'g');

  IF length(digits) = 10 THEN
    local_part := digits;
  ELSIF length(digits) = 11 AND left(digits, 1) = '0' THEN
    local_part := substr(digits, 2);
  ELSIF length(digits) = 12 AND left(digits, 2) = '91' THEN
    local_part := substr(digits, 3);
  ELSE
    -- Not recognisable as an Indian mobile — leave the original alone.
    RETURN p;
  END IF;

  -- Indian mobile numbers always start 6-9.
  IF local_part !~ '^[6-9][0-9]{9}$' THEN
    RETURN p;
  END IF;

  RETURN '+91' || local_part;
END;
$$;

COMMENT ON FUNCTION public.normalise_indian_phone(text) IS
  'Best-effort Indian-phone canonicaliser. Returns E.164 (+91XXXXXXXXXX) for valid inputs; returns the original string unchanged for anything else (foreign numbers, garbage), so the migration never silently destroys data.';

-- =====================================================================
-- 1. Normalise every existing customers.phone in place
-- =====================================================================
UPDATE public.customers
   SET phone = public.normalise_indian_phone(phone)
 WHERE phone IS NOT NULL
   AND phone <> public.normalise_indian_phone(phone);

-- =====================================================================
-- 2. Merge duplicates — keep oldest, repoint bookings, delete losers
-- =====================================================================
DO $$
DECLARE
  r record;
  v_keep_id uuid;
  v_drop_id uuid;
  v_merged integer := 0;
  v_repointed integer := 0;
BEGIN
  -- For each (phone) with >1 row, walk every non-keeper row.
  FOR r IN
    WITH dupes AS (
      SELECT phone
      FROM public.customers
      WHERE phone IS NOT NULL
      GROUP BY phone
      HAVING count(*) > 1
    ),
    ranked AS (
      SELECT
        c.id,
        c.phone,
        first_value(c.id) OVER (
          PARTITION BY c.phone
          ORDER BY c.created_at ASC, c.id ASC
        ) AS keeper_id
      FROM public.customers c
      JOIN dupes d USING (phone)
    )
    SELECT keeper_id, id AS drop_id, phone
    FROM ranked
    WHERE id <> keeper_id
  LOOP
    v_keep_id := r.keeper_id;
    v_drop_id := r.drop_id;

    -- Repoint bookings onto the keeper.
    WITH up AS (
      UPDATE public.bookings
         SET customer_id = v_keep_id
       WHERE customer_id = v_drop_id
      RETURNING 1
    )
    SELECT count(*) INTO v_repointed FROM up;

    -- Drop the duplicate. ON DELETE SET NULL on bookings.customer_id is
    -- the M1 default, but every booking has already been repointed above,
    -- so the delete is clean.
    DELETE FROM public.customers WHERE id = v_drop_id;

    v_merged := v_merged + 1;
    RAISE NOTICE 'Merged customer % into % (phone %, % bookings repointed)',
      v_drop_id, v_keep_id, r.phone, v_repointed;
  END LOOP;

  RAISE NOTICE 'Migration 016: merged % duplicate customers by phone', v_merged;
END $$;

-- =====================================================================
-- 3. UNIQUE index on customers.phone
-- =====================================================================
-- Drop the M1 non-unique index — superseded by the unique one below.
DROP INDEX IF EXISTS public.idx_customers_phone;

CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique
  ON public.customers (phone);

COMMENT ON INDEX public.customers_phone_unique IS
  'Enforces one customer row per phone. NULL phones permitted (UNIQUE indexes treat NULLs as distinct in Postgres). All application paths must call normalise_indian_phone() before INSERT/UPDATE to keep this constraint useful.';
