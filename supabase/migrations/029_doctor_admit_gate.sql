-- 029_doctor_admit_gate.sql
--
-- Consult Room admit-gate (Task #43): add a single nullable timestamp
-- to consultation_sessions recording when the doctor admitted the
-- patient into the video room. NULL = patient is still in the
-- Sanocare-native waiting room (or not yet there). Set once via the
-- POST /api/doctor/admit-patient endpoint; immutable thereafter
-- (enforced in app layer — the write is `... WHERE doctor_admitted_at
-- IS NULL`, so a second attempt is a no-op).
--
-- Applied to prod via Supabase MCP `apply_migration` on 2026-05-29
-- with name `029_doctor_admit_gate`. Post-state confirmed via direct
-- re-query (information_schema + count): col_present=1,
-- sessions_with_admit=0, col_type='timestamp with time zone'.
--
-- This file mirrors the SQL that landed in the database so the repo
-- stays a source-of-truth audit trail alongside Supabase's internal
-- schema_migrations.
--
-- Schema home rationale: the patient /c/[token] page already resolves
-- through consultation_participants → consultation_sessions → doctors
-- (see src/app/c/[token]/page.tsx). Putting this on bookings would
-- force every read path through an extra JOIN. Putting it on
-- consultation_sessions matches where session-state already lives
-- (teleconsult_consent, started_at, ended_at — all M021).
--
-- No index: queried by session id (PK) only. No backfill: historical
-- sessions are all completed; NULL is the correct "this column did
-- not exist when the session ran" value.
--
-- Future hardening (parked, NOT this migration): the app-layer
-- `WHERE doctor_admitted_at IS NULL` guard is the v1 idempotency
-- mechanism. True overwrite-prevention at DB layer requires a
-- row-level BEFORE UPDATE trigger (CHECK cannot reference OLD/NEW).
-- Founder's note on the Q&A: park for now.
--
-- BEGIN/COMMIT stripped per M026/M027/M028 convention — apply_migration
-- wraps its own transaction.

ALTER TABLE public.consultation_sessions
  ADD COLUMN IF NOT EXISTS doctor_admitted_at timestamptz;

COMMENT ON COLUMN public.consultation_sessions.doctor_admitted_at IS
  'Timestamp when the doctor clicked Admit on the Sanocare-native Patient Ready card. NULL = patient is in the Sanocare waiting room (Daily iframe not yet mounted on patient side). Set once via POST /api/doctor/admit-patient; the SQL guard ``WHERE doctor_admitted_at IS NULL`` makes the write idempotent. Drives the patient-side state machine in PatientJoinClient.tsx — once non-null, the patient transitions from waiting-room state into the Daily mount flow.';

-- Post-state sanity (single % per RAISE NOTICE — M022 lesson).
DO $$
DECLARE
  v_sessions_with_admit int;
  v_col_present         int;
BEGIN
  SELECT count(*) INTO v_sessions_with_admit
    FROM public.consultation_sessions
    WHERE doctor_admitted_at IS NOT NULL;

  SELECT count(*) INTO v_col_present
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'consultation_sessions'
      AND column_name  = 'doctor_admitted_at';

  RAISE NOTICE 'M029: doctor_admitted_at column present = %', v_col_present;
  RAISE NOTICE 'M029: sessions w/ doctor_admitted_at set = %', v_sessions_with_admit;
END $$;
