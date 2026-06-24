-- Aarogya auto-register customer (founder-approved 2026-06-24).
--
-- When Aarogya learns a new sender's NAME, it creates a real customers row with a
-- generated customer_code. Two DB pieces:
--   1. customers.source — nullable channel tag ('aarogya_whatsapp' on Aarogya-created
--      rows; existing rows stay NULL) for fundraising-diligence segmentation.
--   2. aarogya_register_customer() — the ATOMIC upsert. next_code('customer') (the
--      shared race-safe counter, NOT a new sequence — confirmed seeded at the live
--      max SAN-C-00034) runs in the SAME statement as the insert/update, so a failed
--      write burns no code number. COALESCE short-circuits, so an existing
--      customer_code / full_name is NEVER regenerated or overwritten (fill-if-null).
--      Acts on exactly one row (the current sender) — no backfill of null-code rows.
--
-- Trio (full_name + phone + customer_code) is enforced at the APP layer, not via DB
-- NOT NULL (that would break the verify-otp phone-only upsert). This fn makes the
-- write atomic; the executor checks the returned row has all three.
--
-- SECURITY DEFINER + pinned search_path (writing-fn convention; called via the
-- service-role client which already bypasses RLS).
--
-- Applied via MCP (recorded version 20260624084548; filename matches).
-- Rolled-back verify passed: new insert (code+source+trio), idempotent re-run with
-- NO code burn, phone-only fill-in (distinct code), existing code/name never
-- regenerated/overwritten; counter intact, zero residue.
--
-- Reversibility:
--   DROP FUNCTION IF EXISTS public.aarogya_register_customer(uuid,text,text,text,text,text,text,text,date,text);
--   ALTER TABLE public.customers DROP COLUMN IF EXISTS source;

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS source text;
COMMENT ON COLUMN public.customers.source IS
  'Channel that created this row. Aarogya auto-register sets ''aarogya_whatsapp''; rows from other channels stay NULL.';

CREATE OR REPLACE FUNCTION public.aarogya_register_customer(
  p_existing_id   uuid,
  p_phone         text,
  p_full_name     text,
  p_address_line  text DEFAULT NULL,
  p_area          text DEFAULT NULL,
  p_city          text DEFAULT NULL,
  p_pincode       text DEFAULT NULL,
  p_email         text DEFAULT NULL,
  p_date_of_birth date DEFAULT NULL,
  p_gender        text DEFAULT NULL
)
RETURNS TABLE (customer_id uuid, is_new boolean, customer_code text, full_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id  uuid;
  v_new boolean := false;
BEGIN
  -- Resolve the row: the caller's authoritative id (identity last-10 match) wins;
  -- else an exact-phone lookup; else it's a genuinely new sender.
  IF p_existing_id IS NOT NULL THEN
    v_id := p_existing_id;
  ELSE
    SELECT c.id INTO v_id FROM public.customers c WHERE c.phone = p_phone LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    -- New sender → INSERT with a code generated inline (same tx → no burn on failure).
    INSERT INTO public.customers (
      phone, full_name, customer_code, source,
      address_line, area, city, pincode, email, date_of_birth, gender
    )
    VALUES (
      p_phone, p_full_name, public.next_code('customer'), 'aarogya_whatsapp',
      p_address_line, p_area, p_city, p_pincode, p_email, p_date_of_birth, p_gender
    )
    RETURNING id INTO v_id;
    v_new := true;
  ELSE
    -- Existing row → fill-if-null only. COALESCE short-circuits, so next_code is
    -- evaluated ONLY when customer_code IS NULL (no burn, never regenerated), and
    -- an existing full_name is never overwritten. source left untouched on existing
    -- rows (their true origin channel is preserved).
    UPDATE public.customers c SET
      full_name     = COALESCE(c.full_name, p_full_name),
      customer_code = COALESCE(c.customer_code, public.next_code('customer')),
      address_line  = COALESCE(c.address_line, p_address_line),
      area          = COALESCE(c.area, p_area),
      city          = COALESCE(c.city, p_city),
      pincode       = COALESCE(c.pincode, p_pincode),
      email         = COALESCE(c.email, p_email),
      date_of_birth = COALESCE(c.date_of_birth, p_date_of_birth),
      gender        = COALESCE(c.gender, p_gender)
    WHERE c.id = v_id;
  END IF;

  RETURN QUERY
    SELECT c.id, v_new, c.customer_code, c.full_name
    FROM public.customers c WHERE c.id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.aarogya_register_customer(uuid,text,text,text,text,text,text,text,date,text) FROM PUBLIC;

COMMENT ON FUNCTION public.aarogya_register_customer IS
  'Aarogya auto-register — atomic customer upsert. next_code(''customer'') runs inline with the insert/update (no burned codes); COALESCE fill-if-null so an existing code/name is never regenerated/overwritten. Returns the resulting (id, is_new, customer_code, full_name) for the app-layer trio check + audit.';
