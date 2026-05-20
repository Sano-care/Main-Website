-- Migration 013 — Customer & partner master records + auto-incrementing codes
--
-- Until now, patient identity has been duplicated inline on every bookings
-- row (patient_name / phone / manual_address). This migration introduces:
--
--   * customers   — one row per patient, with a human-readable code (SAN-C-00001)
--   * partners    — society / clinic / corporate / individual referral sources
--   * code_counters + next_code(type) — atomic, transactional code allocator
--   * bookings.customer_id — FK linking bookings to their customer row
--
-- The migration backfills customers from existing bookings (one customer per
-- distinct phone, using the most recent booking's name + address) and links
-- those bookings to their new customer. Idempotent: safe to re-run.

-- =====================================================================
-- customers
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.customers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code text UNIQUE NOT NULL,
  full_name     text NOT NULL,
  phone         text,
  email         text,
  date_of_birth date,
  gender        text,
  address_line  text,
  area          text,
  city          text,
  pincode       text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES public.ops_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_phone         ON public.customers (phone);
CREATE INDEX IF NOT EXISTS idx_customers_customer_code ON public.customers (customer_code);

COMMENT ON TABLE public.customers IS
  'Master customer (patient) records. One per distinct human; linked from bookings via bookings.customer_id. customer_code is human-readable (SAN-C-00001).';

-- =====================================================================
-- partners
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.partners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_code  text UNIQUE NOT NULL,
  name          text NOT NULL,
  partner_type  text NOT NULL CHECK (partner_type IN ('society','clinic','corporate','individual')),
  contact_name  text,
  phone         text,
  email         text,
  address_line  text,
  city          text,
  pincode       text,
  notes         text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES public.ops_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_partners_partner_code ON public.partners (partner_code);
CREATE INDEX IF NOT EXISTS idx_partners_active       ON public.partners (is_active) WHERE is_active = true;

COMMENT ON TABLE public.partners IS
  'Referral / B2B partner records: housing societies, clinics, corporates, individuals. partner_code is human-readable (SAN-P-00001).';

-- =====================================================================
-- code_counters + next_code(type)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.code_counters (
  code_type   text PRIMARY KEY,
  prefix      text NOT NULL,
  last_number integer NOT NULL DEFAULT 0
);

INSERT INTO public.code_counters (code_type, prefix, last_number) VALUES
  ('customer', 'SAN-C-', 0),
  ('partner',  'SAN-P-', 0)
ON CONFLICT (code_type) DO NOTHING;

-- Atomic counter increment + zero-padded formatted code.
-- The UPDATE ... RETURNING is a single transactional step: two concurrent
-- callers will serialize on the row lock and each get a distinct number.
CREATE OR REPLACE FUNCTION public.next_code(p_type text)
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.code_counters
     SET last_number = last_number + 1
   WHERE code_type = p_type
  RETURNING prefix || lpad(last_number::text, 5, '0');
$$;

REVOKE ALL ON FUNCTION public.next_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_code(text) TO authenticated;

COMMENT ON FUNCTION public.next_code(text) IS
  'Atomically allocate the next human-readable code for the given counter type. Returns e.g. ''SAN-C-00001''. SECURITY DEFINER — callers do not need write access to code_counters.';

-- =====================================================================
-- bookings.customer_id
-- =====================================================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON public.bookings (customer_id);

COMMENT ON COLUMN public.bookings.customer_id IS
  'Optional FK to customers. NULL for legacy bookings whose phone could not be backfilled. Going forward every new booking should set this.';

-- =====================================================================
-- RLS
-- =====================================================================
ALTER TABLE public.customers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partners      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_counters ENABLE ROW LEVEL SECURITY;

-- customers: ops members can read, insert, update.
DROP POLICY IF EXISTS "customers readable by ops" ON public.customers;
CREATE POLICY "customers readable by ops"
  ON public.customers FOR SELECT TO authenticated
  USING (public.is_ops_user());

DROP POLICY IF EXISTS "customers insertable by ops" ON public.customers;
CREATE POLICY "customers insertable by ops"
  ON public.customers FOR INSERT TO authenticated
  WITH CHECK (public.is_ops_user());

DROP POLICY IF EXISTS "customers updatable by ops" ON public.customers;
CREATE POLICY "customers updatable by ops"
  ON public.customers FOR UPDATE TO authenticated
  USING (public.is_ops_user())
  WITH CHECK (public.is_ops_user());

-- partners: ops members can read, insert, update.
DROP POLICY IF EXISTS "partners readable by ops" ON public.partners;
CREATE POLICY "partners readable by ops"
  ON public.partners FOR SELECT TO authenticated
  USING (public.is_ops_user());

DROP POLICY IF EXISTS "partners insertable by ops" ON public.partners;
CREATE POLICY "partners insertable by ops"
  ON public.partners FOR INSERT TO authenticated
  WITH CHECK (public.is_ops_user());

DROP POLICY IF EXISTS "partners updatable by ops" ON public.partners;
CREATE POLICY "partners updatable by ops"
  ON public.partners FOR UPDATE TO authenticated
  USING (public.is_ops_user())
  WITH CHECK (public.is_ops_user());

-- code_counters: no client policies — touched only by next_code() (SECURITY
-- DEFINER), which bypasses RLS via the function owner's privileges. RLS is
-- enabled with no policies so direct client reads/writes always fail.

-- =====================================================================
-- Backfill — one customer per distinct phone, then link existing bookings
-- =====================================================================
DO $$
DECLARE
  v_created integer := 0;
  v_linked  integer := 0;
BEGIN
  WITH latest_per_phone AS (
    SELECT DISTINCT ON (phone)
      phone,
      patient_name,
      manual_address,
      created_at
    FROM public.bookings
    WHERE phone IS NOT NULL
      AND btrim(phone) <> ''
    ORDER BY phone, created_at DESC
  ),
  inserted AS (
    INSERT INTO public.customers (customer_code, full_name, phone, address_line)
    SELECT
      public.next_code('customer'),
      COALESCE(NULLIF(btrim(l.patient_name), ''), 'Unknown'),
      l.phone,
      NULLIF(btrim(l.manual_address), '')
    FROM latest_per_phone l
    WHERE NOT EXISTS (
      SELECT 1 FROM public.customers c WHERE c.phone = l.phone
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_created FROM inserted;

  WITH updated AS (
    UPDATE public.bookings b
       SET customer_id = c.id
      FROM public.customers c
     WHERE b.phone = c.phone
       AND b.customer_id IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_linked FROM updated;

  RAISE NOTICE 'Migration 013 backfill: created % new customers, linked % bookings to a customer', v_created, v_linked;
END $$;
