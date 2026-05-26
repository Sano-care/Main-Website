-- supabase/migrations/023_prescriptions.sql
--
-- C2-Rx: e-prescription module.
--
-- Adds:
--   1. doctors.signature_image_url (text, nullable) — storage path
--      into the private 'doctor-signatures' bucket.
--   2. public.prescriptions — header row per Rx version. Composite
--      UNIQUE (prescription_code, version) supports amend chains
--      where v2 inherits v1's code.
--   3. public.prescription_items — line items (drug, dose, freq,
--      duration, instructions, ordinal).
--   4. Two private storage buckets: 'doctor-signatures' and
--      'prescriptions'.
--   5. code_counters seed for ('prescription', 'SAN-RX-', 0).
--   6. Explicit ops-only RLS policies via public.is_ops_user(),
--      matching the pattern used on bookings / consultation_sessions /
--      consultation_participants / doctors / customers.
--
-- Idempotent. Safe to re-run.

BEGIN;

-- =====================================================================
-- 0. Pre-flight — required dependencies
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_ops_user'
  ) THEN
    RAISE EXCEPTION
      'M023 pre-flight failed: public.is_ops_user() is not defined. '
      'This function is required for the ops-only RLS policies below. '
      'Apply the earlier migration that introduces it before M023.';
  END IF;
END $$;

-- =====================================================================
-- 1. doctors.signature_image_url
-- =====================================================================
ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS signature_image_url text;

COMMENT ON COLUMN public.doctors.signature_image_url IS
  'Storage path (not URL) into the private doctor-signatures bucket. '
  'Rendered into the Rx PDF via a service-role signed URL minted at '
  'render time. Nullable — doctor without a signature on file cannot '
  'send an Rx (server-side guard in the send path).';

-- =====================================================================
-- 2. prescriptions (header)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.prescriptions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Allocated via next_code('prescription') on FRESH draft
  -- creation only. On amend, v2 INHERITS the parent's
  -- prescription_code (next_code NOT called) and bumps version.
  -- Composite UNIQUE (prescription_code, version) defined at the
  -- table level below.
  prescription_code       text NOT NULL,
  version                 integer NOT NULL DEFAULT 1
                          CHECK (version >= 1),

  -- Amend chain: when v(N+1) is created, v(N).superseded_by is set to
  -- v(N+1).id and v(N).status flips to 'superseded'. NULL on the live
  -- (latest) version.
  superseded_by           uuid REFERENCES public.prescriptions(id)
                          ON DELETE SET NULL,

  session_id              uuid NOT NULL
                          REFERENCES public.consultation_sessions(id) ON DELETE RESTRICT,
  booking_id              uuid NOT NULL
                          REFERENCES public.bookings(id) ON DELETE RESTRICT,

  -- doctor_id: the prescribing doctor on this version (allowed to
  -- differ from the original on amend if a different doctor signed v2).
  doctor_id               uuid NOT NULL
                          REFERENCES public.doctors(id) ON DELETE RESTRICT,
  -- created_by_doctor_id: who actually clicked "save"; usually equals
  -- doctor_id but kept distinct for audit.
  created_by_doctor_id    uuid REFERENCES public.doctors(id)
                          ON DELETE SET NULL,

  -- Patient snapshot at time of Rx (denormalised — patient record can
  -- mutate, the Rx PDF must not).
  patient_name            text NOT NULL,
  patient_age             integer CHECK (patient_age IS NULL OR (patient_age >= 0 AND patient_age <= 130)),
  patient_sex             text CHECK (patient_sex IS NULL OR patient_sex IN ('M','F','O','U')),
  patient_weight_kg       numeric CHECK (patient_weight_kg IS NULL OR (patient_weight_kg > 0 AND patient_weight_kg < 500)),

  chief_complaint         text,
  provisional_diagnosis   text,
  general_advice          text,
  follow_up_advice        text,

  -- PDF artifact (private bucket 'prescriptions').
  pdf_storage_path        text,

  -- Patient-facing read-only view at /rx/<token>. NULL until sent.
  patient_view_token      text,

  -- WhatsApp delivery receipt.
  whatsapp_sent_at        timestamptz,
  whatsapp_message_id     text,

  status                  text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','sent','superseded','voided')),

  created_at              timestamptz NOT NULL DEFAULT now(),
  sent_at                 timestamptz,
  voided_at               timestamptz,
  void_reason             text,

  CONSTRAINT prescriptions_code_version_unique UNIQUE (prescription_code, version)
);

CREATE INDEX IF NOT EXISTS prescriptions_session_idx
  ON public.prescriptions (session_id);
CREATE INDEX IF NOT EXISTS prescriptions_booking_idx
  ON public.prescriptions (booking_id);
CREATE INDEX IF NOT EXISTS prescriptions_doctor_created_idx
  ON public.prescriptions (doctor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS prescriptions_status_sent_idx
  ON public.prescriptions (status, sent_at DESC);

-- Patient-view token is sparse (NULL on drafts) — partial UNIQUE only
-- where present, so multiple drafts don't collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS prescriptions_patient_view_token_unique
  ON public.prescriptions (patient_view_token)
  WHERE patient_view_token IS NOT NULL;

-- =====================================================================
-- 3. prescription_items
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.prescription_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL
                  REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  ordinal         integer NOT NULL CHECK (ordinal >= 1),
  drug_name       text NOT NULL,
  dose            text,
  frequency       text,
  duration        text,
  instructions    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prescription_items_ordinal_unique UNIQUE (prescription_id, ordinal)
);

CREATE INDEX IF NOT EXISTS prescription_items_rx_idx
  ON public.prescription_items (prescription_id, ordinal);

-- =====================================================================
-- 4. Storage buckets (private)
-- =====================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('doctor-signatures', 'doctor-signatures', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('prescriptions', 'prescriptions', false)
ON CONFLICT (id) DO NOTHING;

-- =====================================================================
-- 5. code_counters seed for SAN-RX-NNNNN
-- =====================================================================
INSERT INTO public.code_counters (code_type, prefix, last_number)
VALUES ('prescription', 'SAN-RX-', 0)
ON CONFLICT (code_type) DO NOTHING;

-- =====================================================================
-- 6. RLS — ops-only explicit policies via public.is_ops_user()
-- =====================================================================
ALTER TABLE public.prescriptions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;

-- prescriptions ----------------------------------------------------------
DROP POLICY IF EXISTS prescriptions_ops_select ON public.prescriptions;
DROP POLICY IF EXISTS prescriptions_ops_insert ON public.prescriptions;
DROP POLICY IF EXISTS prescriptions_ops_update ON public.prescriptions;

CREATE POLICY prescriptions_ops_select
  ON public.prescriptions
  FOR SELECT
  USING (public.is_ops_user());

CREATE POLICY prescriptions_ops_insert
  ON public.prescriptions
  FOR INSERT
  WITH CHECK (public.is_ops_user());

CREATE POLICY prescriptions_ops_update
  ON public.prescriptions
  FOR UPDATE
  USING (public.is_ops_user())
  WITH CHECK (public.is_ops_user());

-- Intentionally no DELETE policy: prescriptions are immutable medical
-- records. Use status = 'voided' + voided_at + void_reason instead.

-- prescription_items -----------------------------------------------------
DROP POLICY IF EXISTS prescription_items_ops_select ON public.prescription_items;
DROP POLICY IF EXISTS prescription_items_ops_insert ON public.prescription_items;
DROP POLICY IF EXISTS prescription_items_ops_update ON public.prescription_items;
DROP POLICY IF EXISTS prescription_items_ops_delete ON public.prescription_items;

CREATE POLICY prescription_items_ops_select
  ON public.prescription_items
  FOR SELECT
  USING (public.is_ops_user());

CREATE POLICY prescription_items_ops_insert
  ON public.prescription_items
  FOR INSERT
  WITH CHECK (public.is_ops_user());

CREATE POLICY prescription_items_ops_update
  ON public.prescription_items
  FOR UPDATE
  USING (public.is_ops_user())
  WITH CHECK (public.is_ops_user());

-- DELETE is allowed on items (unlike the header) so that ops can prune
-- lines from a DRAFT before it's sent. The server action enforces the
-- "draft only" rule; this policy only enforces "must be ops".
CREATE POLICY prescription_items_ops_delete
  ON public.prescription_items
  FOR DELETE
  USING (public.is_ops_user());

-- =====================================================================
-- 7. Sanity summary
-- =====================================================================
DO $$
DECLARE
  v_doctors_with_sig integer;
  v_rx_count         integer;
  v_items_count      integer;
  v_counter_present  integer;
  v_buckets_present  integer;
  v_rx_policies      integer;
  v_item_policies    integer;
BEGIN
  SELECT count(*) INTO v_doctors_with_sig
    FROM public.doctors
    WHERE signature_image_url IS NOT NULL;
  SELECT count(*) INTO v_rx_count
    FROM public.prescriptions;
  SELECT count(*) INTO v_items_count
    FROM public.prescription_items;
  SELECT count(*) INTO v_counter_present
    FROM public.code_counters
    WHERE code_type = 'prescription';
  SELECT count(*) INTO v_buckets_present
    FROM storage.buckets
    WHERE id IN ('doctor-signatures','prescriptions');
  SELECT count(*) INTO v_rx_policies
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'prescriptions';
  SELECT count(*) INTO v_item_policies
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'prescription_items';

  RAISE NOTICE 'M023 sanity: doctors w/ signature  = %', v_doctors_with_sig;
  RAISE NOTICE 'M023 sanity: prescriptions rows   = %', v_rx_count;
  RAISE NOTICE 'M023 sanity: rx items rows        = %', v_items_count;
  RAISE NOTICE 'M023 sanity: code_counters rx     = % (expect 1)', v_counter_present;
  RAISE NOTICE 'M023 sanity: storage buckets      = % (expect 2)', v_buckets_present;
  RAISE NOTICE 'M023 sanity: prescriptions policies     = % (expect 3)', v_rx_policies;
  RAISE NOTICE 'M023 sanity: prescription_items policies = % (expect 4)', v_item_policies;
  RAISE NOTICE 'Migration 023 complete.';
END $$;

COMMIT;
