-- M064 — GDA / Attendant Phase 1.
--
-- Adds a home-care "attendant" (GDA) workforce sub-type alongside nurses,
-- driven entirely by ops in Phase 1 (patient-facing booking is Phase 2).
-- Reuses the medic stack (auth, attendance-style clock, ledger, documents);
-- this migration only adds the new shape:
--
--   1. medics.staff_type + medics.insulin_med_cleared   (D2a competency flag)
--   2. gda_deployments   — a GDA engaged for a patient over a date range
--   3. gda_shifts        — one scheduled shift; its own clock-in/out + status
--   4. gda_shift_checklist — the per-shift 15-task checklist
--   5. medic_ledger_entries: + gda_shift_id anchor, widened entry_type CHECK
--      ('gda_shift'), and a partial UNIQUE making a double accrual impossible
--   6. post_gda_shift_earning / reverse_gda_shift_earning — append-only money path
--   7. RLS deny-all on the three new tables (service-role access only)
--
-- Decisions locked by founder 2026-06-22: D1 deployment+shifts · D2 all 15 tasks ·
-- D2a per-GDA insulin_med_cleared + family medication consent on the deployment ·
-- D3 12h & 24h · D4 single-shift deployments valid (end_date nullable) ·
-- D5 remote supervision only · D6 stays under service_category='homecare',
-- attendant flagged via deployment_type — NO new service_category.
--
-- Applied via Supabase MCP apply_migration (which wraps its own transaction),
-- so no inner BEGIN/COMMIT (same convention as M035).
--
-- Reversibility:
--   DROP FUNCTION IF EXISTS reverse_gda_shift_earning(uuid);
--   DROP FUNCTION IF EXISTS post_gda_shift_earning(uuid);
--   DROP INDEX IF EXISTS uq_medic_ledger_gda_shift;
--   ALTER TABLE medic_ledger_entries DROP COLUMN IF EXISTS gda_shift_id;
--   -- (restore the pre-M064 entry_type CHECK without 'gda_shift')
--   DROP TABLE IF EXISTS gda_shift_checklist;
--   DROP TABLE IF EXISTS gda_shifts;
--   DROP TABLE IF EXISTS gda_deployments;
--   ALTER TABLE medics DROP COLUMN IF EXISTS insulin_med_cleared, DROP COLUMN IF EXISTS staff_type;

-- 1. Staff discriminator + competency flag. Default 'nurse' preserves every
--    existing medic row unchanged (no behavior change to nurses).
ALTER TABLE public.medics
  ADD COLUMN IF NOT EXISTS staff_type text NOT NULL DEFAULT 'nurse'
    CHECK (staff_type IN ('nurse','gda')),
  ADD COLUMN IF NOT EXISTS insulin_med_cleared boolean NOT NULL DEFAULT false;

-- 2. Deployment — a GDA engaged for a patient over a date range (D1/D4).
CREATE TABLE IF NOT EXISTS public.gda_deployments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            uuid REFERENCES public.bookings(id) ON DELETE SET NULL,   -- under homecare (D6); nullable for ops-created
  customer_id           uuid REFERENCES public.customers(id) ON DELETE SET NULL,  -- required for vitals to post to vital_readings
  patient_name          text NOT NULL,
  address               text NOT NULL,
  deployment_type       text NOT NULL DEFAULT 'attendant' CHECK (deployment_type IN ('attendant')),
  shift_pattern         text NOT NULL CHECK (shift_pattern IN ('12h','24h')),     -- D3
  start_date            date NOT NULL,
  end_date              date,                                                     -- D4 nullable (single-day / open-ended)
  rate_per_shift_paise  integer CHECK (rate_per_shift_paise IS NULL OR rate_per_shift_paise >= 0),  -- customer rate (config)
  medication_consent_at timestamptz,                                              -- D2a family medication consent
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES public.ops_users(id) ON DELETE SET NULL,
  CONSTRAINT gda_deployments_dates_ck CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_gda_deployments_status   ON public.gda_deployments(status, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_gda_deployments_customer ON public.gda_deployments(customer_id) WHERE customer_id IS NOT NULL;

-- 3. Shift — one scheduled GDA shift; the attendance + payout unit. Its OWN
--    clock-in/out (NOT medic_attendance) and a uniqueness rule so the same GDA
--    can't be double-booked for the same kind on the same day.
CREATE TABLE IF NOT EXISTS public.gda_shifts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL REFERENCES public.gda_deployments(id) ON DELETE RESTRICT,
  gda_id        uuid NOT NULL REFERENCES public.medics(id) ON DELETE RESTRICT,
  shift_date    date NOT NULL,
  shift_kind    text NOT NULL CHECK (shift_kind IN ('day12','night12','full24')),
  clock_in_at   timestamptz,
  clock_out_at  timestamptz,
  status        text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','done','missed')),
  payout_paise  integer CHECK (payout_paise IS NULL OR payout_paise >= 0),        -- GDA pay for the shift (config)
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gda_id, shift_date, shift_kind)
);
CREATE INDEX IF NOT EXISTS idx_gda_shifts_gda_date    ON public.gda_shifts(gda_id, shift_date DESC);
CREATE INDEX IF NOT EXISTS idx_gda_shifts_deployment  ON public.gda_shifts(deployment_id);

-- 4. Per-shift checklist — the 15 tasks (D2: all performed). Vitals task_keys
--    (bp/pulse/sugar/temperature) carry their reading in `value`.
CREATE TABLE IF NOT EXISTS public.gda_shift_checklist (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id  uuid NOT NULL REFERENCES public.gda_shifts(id) ON DELETE CASCADE,
  task_key  text NOT NULL,
  value     text,
  done_at   timestamptz,
  UNIQUE (shift_id, task_key)
);
CREATE INDEX IF NOT EXISTS idx_gda_checklist_shift ON public.gda_shift_checklist(shift_id);

-- 5. Ledger reuse — idempotency anchor + widened enum + DB-level double-post guard.
ALTER TABLE public.medic_ledger_entries
  ADD COLUMN IF NOT EXISTS gda_shift_id uuid REFERENCES public.gda_shifts(id) ON DELETE SET NULL;

ALTER TABLE public.medic_ledger_entries
  DROP CONSTRAINT IF EXISTS medic_ledger_entries_entry_type_check;
ALTER TABLE public.medic_ledger_entries
  ADD CONSTRAINT medic_ledger_entries_entry_type_check CHECK (entry_type IN (
    'revenue_share','commission','daily_wage','overtime','payout','adjustment','reversal','gda_shift'
  ));

-- At most one 'gda_shift' accrual per shift — a double-post is impossible at the
-- DB, not just app-level. Reversal rows (entry_type='reversal') carry the same
-- gda_shift_id but are excluded by the predicate, so reverse-and-repost is fine.
CREATE UNIQUE INDEX IF NOT EXISTS uq_medic_ledger_gda_shift
  ON public.medic_ledger_entries(gda_shift_id)
  WHERE entry_type = 'gda_shift';

-- 6. Money path. Accrual on clock-out, reversal on undo. Append-only: we never
--    UPDATE/DELETE a ledger row; an undo posts a compensating 'reversal' entry.
--    SECURITY DEFINER + pinned search_path (writing-function convention; called
--    via the service-role client which already bypasses RLS).
CREATE OR REPLACE FUNCTION public.post_gda_shift_earning(p_shift_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gda_id       uuid;
  v_payout_paise integer;
  v_existing     uuid;
  v_entry_date   date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_new_id       uuid;
BEGIN
  SELECT gda_id, payout_paise INTO v_gda_id, v_payout_paise
  FROM gda_shifts WHERE id = p_shift_id;
  IF v_gda_id IS NULL THEN
    RAISE EXCEPTION 'gda_shift % not found', p_shift_id;
  END IF;

  -- Idempotent: a gda_shift accrual already exists for this shift → no-op.
  SELECT id INTO v_existing
  FROM medic_ledger_entries
  WHERE gda_shift_id = p_shift_id AND entry_type = 'gda_shift'
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- No payout configured yet (config is an ops field set later) → nothing to
  -- accrue; the shift still completes. Ops can post a manual entry when rates land.
  IF v_payout_paise IS NULL OR v_payout_paise = 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO medic_ledger_entries (
    medic_id, entry_type, amount_paise, entry_date, description, gda_shift_id
  )
  VALUES (
    v_gda_id, 'gda_shift', v_payout_paise, v_entry_date,
    'GDA shift earning', p_shift_id
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_gda_shift_earning(p_shift_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orig_id     uuid;
  v_orig_amount bigint;
  v_orig_medic  uuid;
  v_already     uuid;
  v_entry_date  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_rev_id      uuid;
BEGIN
  SELECT id, amount_paise, medic_id INTO v_orig_id, v_orig_amount, v_orig_medic
  FROM medic_ledger_entries
  WHERE gda_shift_id = p_shift_id AND entry_type = 'gda_shift'
  LIMIT 1;
  IF v_orig_id IS NULL THEN
    RETURN NULL;  -- nothing accrued for this shift → nothing to reverse
  END IF;

  -- Idempotent: already reversed → no-op.
  SELECT id INTO v_already
  FROM medic_ledger_entries
  WHERE reverses_entry_id = v_orig_id
  LIMIT 1;
  IF v_already IS NOT NULL THEN
    RETURN v_already;
  END IF;

  INSERT INTO medic_ledger_entries (
    medic_id, entry_type, amount_paise, entry_date, description,
    gda_shift_id, reverses_entry_id
  )
  VALUES (
    v_orig_medic, 'reversal', -v_orig_amount, v_entry_date,
    'GDA shift earning reversed (clock-out undone)', p_shift_id, v_orig_id
  )
  RETURNING id INTO v_rev_id;

  RETURN v_rev_id;
END;
$$;

-- 7. RLS deny-all (no policies) — all reads/writes go through the service-role
--    client in the API layer, scoped by medic_id/ops gate in app code. Matches
--    the project-wide RLS-deny-all-tables rule.
ALTER TABLE public.gda_deployments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gda_shifts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gda_shift_checklist ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.gda_deployments IS
  'GDA Phase 1 (M064) — attendant engagement: a GDA assigned to a patient over a date range. deployment_type=attendant under service_category=homecare (D6).';
COMMENT ON TABLE public.gda_shifts IS
  'GDA Phase 1 (M064) — one scheduled GDA shift; own clock-in/out + status; the attendance+payout unit. UNIQUE(gda_id,shift_date,shift_kind).';
COMMENT ON TABLE public.gda_shift_checklist IS
  'GDA Phase 1 (M064) — per-shift 15-task checklist; vitals task_keys mirror to vital_readings when the deployment has a customer_id.';
COMMENT ON FUNCTION public.post_gda_shift_earning IS
  'GDA Phase 1 (M064) — idempotent append-only accrual: posts one gda_shift ledger row (= payout_paise) per shift on clock-out. No-op if already posted or no payout configured.';
COMMENT ON FUNCTION public.reverse_gda_shift_earning IS
  'GDA Phase 1 (M064) — append-only reversal: posts a compensating reversal row when a clock-out is undone. Idempotent.';
