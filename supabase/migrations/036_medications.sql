-- Migration convention: partial-index predicates must be IMMUTABLE.
-- CURRENT_DATE / now() / current_timestamp are STABLE, not IMMUTABLE,
-- so they cannot appear in WHERE clauses on CREATE INDEX. Use IS NULL,
-- = against literals, or IN against literals. The original spec for
-- this migration tried `WHERE end_date IS NULL OR end_date >= CURRENT_DATE`
-- and was rejected by Postgres 42P17. Fix: narrow to `WHERE end_date IS NULL`.

-- Migration 036: Patient medication schedule + per-dose intake log.
-- "medications" is the active schedule. Inactive (ended) meds stay in the
-- table for history with end_date set.
-- "medication_intake_log" is one row per scheduled dose, marked
-- taken/skipped/missed.
--
-- T62 corrections:
--   - patients(id) → customers(id), same as M035 and the M033/M034
--     precedent.
--   - source_rx_id references prescriptions(id) directly.
--   - NEW: imported_needs_review boolean (single flag, single grain,
--     per founder direction).
--   - Partial index predicate narrowed from
--     "end_date IS NULL OR end_date >= CURRENT_DATE"
--     to "end_date IS NULL". CURRENT_DATE is STABLE (changes across
--     transactions) so Postgres rejects it in partial-index predicates
--     (must be IMMUTABLE). The IS NULL branch covers the vast majority
--     of active meds; the rare "ended today or later" sliver falls
--     through to a seq scan bounded by the customer's row count.
--
-- T62 naming: surface is "Sanocare Pulse" — patient_portal terminology
-- is deprecated. Schema is naming-neutral.
--
-- apply_migration wraps its own transaction; do NOT add BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS public.medications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  name            text NOT NULL,
  dose            text NOT NULL,
  frequency_label text NOT NULL,
  times_per_day   integer NOT NULL DEFAULT 1
                    CHECK (times_per_day BETWEEN 0 AND 6),
  scheduled_times jsonb,
  start_date      date NOT NULL DEFAULT CURRENT_DATE,
  end_date        date,
  reason          text,
  source          text NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual', 'rx_import')),
  source_rx_id    uuid REFERENCES public.prescriptions(id) ON DELETE SET NULL,
  imported_needs_review boolean NOT NULL DEFAULT false,
  refill_warning_threshold_days integer NOT NULL DEFAULT 5,
  supply_qty      integer,
  supply_updated_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medications_customer_active
  ON public.medications (customer_id, start_date DESC)
  WHERE end_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_medications_needs_review
  ON public.medications (customer_id)
  WHERE imported_needs_review = true;

CREATE TABLE IF NOT EXISTS public.medication_intake_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id   uuid NOT NULL REFERENCES public.medications(id) ON DELETE CASCADE,
  scheduled_at    timestamptz NOT NULL,
  taken_at        timestamptz,
  state           text NOT NULL DEFAULT 'pending'
                    CHECK (state IN ('pending', 'taken', 'skipped', 'missed')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medication_intake_log_med_scheduled_at
  ON public.medication_intake_log (medication_id, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_medication_intake_log_med_pending
  ON public.medication_intake_log (medication_id, scheduled_at)
  WHERE state = 'pending';

COMMENT ON TABLE public.medications IS
  'Patient medication schedule. Active = end_date NULL or >= today. '
  'imported_needs_review surfaces lossy rx_import heuristics to the patient.';

COMMENT ON COLUMN public.medications.imported_needs_review IS
  'TRUE iff this row was created via rx_import AND at least one of '
  '(times_per_day, scheduled_times, end_date) was derived from a '
  'heuristic default rather than the source Rx. UI renders a "Review" '
  'pill on these rows. Cleared on any patient edit to one of those '
  'fields.';

COMMENT ON TABLE public.medication_intake_log IS
  'Per-dose intake log. Adherence stats derive from this.';

DO $$
DECLARE
  meds_present int;
  meds_indexes int;
  meds_columns int;
  log_present int;
  log_indexes int;
  log_columns int;
BEGIN
  SELECT count(*) INTO meds_present FROM information_schema.tables WHERE table_schema='public' AND table_name='medications';
  SELECT count(*) INTO meds_indexes FROM pg_indexes WHERE schemaname='public' AND tablename='medications';
  SELECT count(*) INTO meds_columns FROM information_schema.columns WHERE table_schema='public' AND table_name='medications';
  SELECT count(*) INTO log_present FROM information_schema.tables WHERE table_schema='public' AND table_name='medication_intake_log';
  SELECT count(*) INTO log_indexes FROM pg_indexes WHERE schemaname='public' AND tablename='medication_intake_log';
  SELECT count(*) INTO log_columns FROM information_schema.columns WHERE table_schema='public' AND table_name='medication_intake_log';
  RAISE NOTICE 'medications present=% indexes=% columns=% (expected 1 / 3 / 17)', meds_present, meds_indexes, meds_columns;
  RAISE NOTICE 'medication_intake_log present=% indexes=% columns=% (expected 1 / 3 / 7)', log_present, log_indexes, log_columns;
END $$;
