-- 032_ops_framework_phase1.sql
--
-- Phase 1 of the Ops Framework rollout (founder Qs 1–8 from
-- Ops_Assignment_Framework_v0.md). Adds: assignment + audit columns
-- on bookings (skipping doctor_id — already exists), two-state
-- attendance on consultation_sessions, per-medic payout column,
-- doctor_presence_log table, admitted_at on consultation_participants,
-- backfill of admitted_at from session-level first_admitted_at for
-- PR #22 test sessions, vw_patient_session_log read-only view.
--
-- Applied to prod via Supabase MCP `apply_migration` on 2026-06-01
-- with name `032_ops_framework_phase1`. Post-state confirmed via
-- direct re-query: bookings_assignment_cols=4, session_attendance_
-- cols=3, paramedic_payout_col=1, presence_table=1, participants_
-- admitted_col=1, view_present=1, backfilled_rows=2 (SAN-B-00056 +
-- SAN-B-00057; SAN-B-00055 was admitted pre-M031 and correctly
-- skipped by the backfill).
--
-- All adds nullable / idempotent (IF NOT EXISTS). Safe to apply hot.
-- Backfill in §5.5 is idempotent (WHERE admitted_at IS NULL) — re-running
-- the migration is a no-op.
--
-- Renumbered from "M028" in the original brief: M028 through M031
-- are taken (rx_v5_fields, doctor_admit_gate, first_joined_at_audit,
-- first_admitted_at_audit). Next free = M032.
--
-- Founder decisions baked in:
--   - Doctor payouts: reuse existing M019 columns
--     (commission_per_visit_paise + daily_wage_paise). NOT adding
--     duplicate per_visit_payout_paise / daily_payout_paise on doctors.
--   - bookings.doctor_id: pre-existing column, reuse for the doctor
--     assignment. Only assigned_paramedic_id + assigned_partner_id
--     are new resource columns; assigned_at + assigned_by are the new
--     audit columns and apply to ALL three assignment kinds.
--   - assigned_by FK target: public.ops_users(id).
--   - §5.5 backfill: UPDATE patient participant rows where the session's
--     first_admitted_at is already populated (PR #22 test sessions).
--     Otherwise the new view would mis-report admitted_to_consultation =
--     false for sessions that genuinely happened.
--
-- Three Phase-3 considerations flagged by founder (no action in M032):
--   1. assigned_at = most-recent-assignment-across-all-roles. Phase 3
--      payout report uses session timestamps anyway.
--   2. attendance_status DEFAULT 'not_attended' backfills historical
--      rows. Phase 3 reports filter on attendance_marked_at IS NOT NULL.
--   3. doctor_presence_log RLS blocks doctor-context inserts. Phase 3
--      first-login wiring needs a policy update OR service-role write.
--
-- BEGIN/COMMIT stripped per M026–M031 convention — apply_migration
-- wraps its own transaction.

-- ---------------------------------------------------------------------
-- 1. Assignment + audit columns on bookings
-- ---------------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS assigned_paramedic_id  uuid REFERENCES public.paramedics(id),
  ADD COLUMN IF NOT EXISTS assigned_partner_id    uuid REFERENCES public.partners(id),
  ADD COLUMN IF NOT EXISTS assigned_at            timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_by            uuid REFERENCES public.ops_users(id);

COMMENT ON COLUMN public.bookings.assigned_at IS
  'Timestamp of the most recent ops assignment action (doctor, paramedic, or partner). Set/updated by /api/ops/assign-*. Companion: assigned_by.';
COMMENT ON COLUMN public.bookings.assigned_by IS
  'ops_users.id of the operator who performed the most recent assignment. Audit trail.';

-- ---------------------------------------------------------------------
-- 2. Two-state attendance on consultation_sessions (Q2)
-- ---------------------------------------------------------------------
ALTER TABLE public.consultation_sessions
  ADD COLUMN IF NOT EXISTS attendance_status text
    CHECK (attendance_status IN ('not_attended','attended'))
    DEFAULT 'not_attended',
  ADD COLUMN IF NOT EXISTS attendance_marked_at  timestamptz,
  ADD COLUMN IF NOT EXISTS attendance_marked_by  uuid REFERENCES public.doctors(id);

COMMENT ON COLUMN public.consultation_sessions.attendance_status IS
  'Two-state attendance per Q2 (no-show + cancel collapse into not_attended; no payout). Written by Mark Attended on the lobby panel; gated by the Q8 saved-Rx check (chief_complaint AND provisional_diagnosis non-empty).';

-- ---------------------------------------------------------------------
-- 3. Per-medic payout column (Q1)
-- ---------------------------------------------------------------------
ALTER TABLE public.paramedics
  ADD COLUMN IF NOT EXISTS per_visit_payout_paise integer;

COMMENT ON COLUMN public.paramedics.per_visit_payout_paise IS
  'Per-visit payout for this medic, in paise. NULL = not yet configured. Set by ops admin at onboarding. Phase 3 payout report aggregates this × attended visit count.';

-- ---------------------------------------------------------------------
-- 4. Doctor presence log (Q4 — schema only; first-login wiring = Phase 3)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.doctor_presence_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id       uuid NOT NULL REFERENCES public.doctors(id),
  presence_date   date NOT NULL,
  first_login_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doctor_id, presence_date)
);

CREATE INDEX IF NOT EXISTS idx_doctor_presence_log_date
  ON public.doctor_presence_log(presence_date DESC);

ALTER TABLE public.doctor_presence_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "doctor_presence_log readable by ops" ON public.doctor_presence_log;
CREATE POLICY "doctor_presence_log readable by ops"
  ON public.doctor_presence_log FOR SELECT TO authenticated
  USING (public.is_ops_user());

DROP POLICY IF EXISTS "doctor_presence_log insertable by ops" ON public.doctor_presence_log;
CREATE POLICY "doctor_presence_log insertable by ops"
  ON public.doctor_presence_log FOR INSERT TO authenticated
  WITH CHECK (public.is_ops_user());

DROP POLICY IF EXISTS "doctor_presence_log updatable by ops" ON public.doctor_presence_log;
CREATE POLICY "doctor_presence_log updatable by ops"
  ON public.doctor_presence_log FOR UPDATE TO authenticated
  USING (public.is_ops_user()) WITH CHECK (public.is_ops_user());

COMMENT ON TABLE public.doctor_presence_log IS
  'One row per (doctor, calendar date) recording first login + last activity timestamps. Phase 3 wires the first-login-of-day write via /api/doctor/verify-otp success path. Phase 1 ships the schema only. Founder note: current RLS blocks doctor-context inserts; Phase 3 will need a policy update OR a service-role write path for the first-login wiring.';

-- ---------------------------------------------------------------------
-- 5. admitted_at on participants
-- ---------------------------------------------------------------------
ALTER TABLE public.consultation_participants
  ADD COLUMN IF NOT EXISTS admitted_at timestamptz;

COMMENT ON COLUMN public.consultation_participants.admitted_at IS
  'Timestamp when this participant was admitted into the consult room. For the patient row, lazy-filled by app on first admit (mirrors consultation_sessions.first_admitted_at). For future medic-role rows (Phase 2, Q6), set when medic joins Daily. NOT cleared by Send to Waiting — that flips the session-level live flag only; admitted_at stays as an audit anchor.';

-- ---------------------------------------------------------------------
-- 5.5. Backfill admitted_at from session-level first_admitted_at (M031)
-- ---------------------------------------------------------------------
-- PR #22 test sessions (SAN-B-00055 → 00057) admitted patients before
-- this column existed; their consultation_sessions.first_admitted_at
-- IS populated, but consultation_participants.admitted_at is NULL.
-- Without this backfill, vw_patient_session_log would mis-report
-- admitted_to_consultation = false for sessions that genuinely happened.
--
-- Idempotent: WHERE cp.admitted_at IS NULL means re-running this
-- migration touches zero rows on the second pass. Confirmed impact at
-- apply-time: 2 rows (SAN-B-00056 + SAN-B-00057; SAN-B-00055 admitted
-- pre-M031 → first_admitted_at NULL → correctly skipped).
UPDATE public.consultation_participants cp
SET    admitted_at = cs.first_admitted_at
FROM   public.consultation_sessions cs
WHERE  cp.session_id            = cs.id
  AND  cp.role                  = 'patient'
  AND  cs.first_admitted_at IS NOT NULL
  AND  cp.admitted_at       IS NULL;

-- ---------------------------------------------------------------------
-- 6. Patient session log view (§3.5)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_patient_session_log AS
SELECT
  c.customer_code                          AS patient_id,
  c.full_name                              AS patient_name,
  c.phone                                  AS patient_phone,
  b.booking_code                           AS booking_id,
  b.amount::numeric                        AS payment_amount,
  b.payment_status,
  b.service_category,
  cs.id                                    AS session_id,
  cs.doctor_id,
  d.doctor_code                            AS doctor_code,
  d.full_name                              AS doctor_name,
  cp.joined_at                             AS waiting_room_joined_at,
  cp.joined_at IS NOT NULL                 AS joined_waiting_room,
  cp.admitted_at                           AS consultation_admitted_at,
  cp.admitted_at IS NOT NULL               AS admitted_to_consultation,
  cs.attendance_status,
  cs.attendance_marked_at,
  cs.scheduled_at,
  cs.started_at,
  cs.ended_at
FROM      public.bookings                   b
LEFT JOIN public.customers                  c  ON c.id = b.customer_id
LEFT JOIN public.consultation_sessions      cs ON cs.booking_id = b.id
LEFT JOIN public.consultation_participants  cp ON cp.session_id = cs.id AND cp.role = 'patient'
LEFT JOIN public.doctors                    d  ON d.id = cs.doctor_id;

COMMENT ON VIEW public.vw_patient_session_log IS
  'Read-only join surfacing the three "did the consult happen?" signals per booking: joined_waiting_room (cp.joined_at IS NOT NULL), admitted_to_consultation (cp.admitted_at IS NOT NULL), attendance_status. Non-teleconsult bookings (homecare, nursing, pathology) appear with NULL session/participant columns — the LEFT JOINs accommodate this.';

-- ---------------------------------------------------------------------
-- 7. Post-state sanity (single % per RAISE NOTICE — M022 lesson)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_booking_cols       int;
  v_session_cols       int;
  v_paramedic_payout   int;
  v_presence_table     int;
  v_participants_col   int;
  v_view_present       int;
  v_backfilled_rows    int;
BEGIN
  SELECT count(*) INTO v_booking_cols
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bookings'
      AND column_name IN ('assigned_paramedic_id','assigned_partner_id','assigned_at','assigned_by');

  SELECT count(*) INTO v_session_cols
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='consultation_sessions'
      AND column_name IN ('attendance_status','attendance_marked_at','attendance_marked_by');

  SELECT count(*) INTO v_paramedic_payout
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='paramedics'
      AND column_name = 'per_visit_payout_paise';

  SELECT count(*) INTO v_presence_table
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='doctor_presence_log';

  SELECT count(*) INTO v_participants_col
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='consultation_participants'
      AND column_name = 'admitted_at';

  SELECT count(*) INTO v_view_present
    FROM information_schema.views
    WHERE table_schema='public' AND table_name='vw_patient_session_log';

  SELECT count(*) INTO v_backfilled_rows
    FROM public.consultation_participants cp
    JOIN public.consultation_sessions     cs ON cs.id = cp.session_id
    WHERE cp.role             = 'patient'
      AND cp.admitted_at IS NOT NULL
      AND cs.first_admitted_at IS NOT NULL
      AND cp.admitted_at      = cs.first_admitted_at;

  RAISE NOTICE 'M032: bookings assignment cols added = %', v_booking_cols;
  RAISE NOTICE 'M032: consultation_sessions attendance cols = %', v_session_cols;
  RAISE NOTICE 'M032: paramedics payout col = %', v_paramedic_payout;
  RAISE NOTICE 'M032: doctor_presence_log table = %', v_presence_table;
  RAISE NOTICE 'M032: consultation_participants admitted_at = %', v_participants_col;
  RAISE NOTICE 'M032: vw_patient_session_log view = %', v_view_present;
  RAISE NOTICE 'M032: backfilled admitted_at rows = %', v_backfilled_rows;
END $$;
