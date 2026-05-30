-- 031_first_admitted_at_audit.sql
--
-- Consult Room PR #22 round 4 bug A fix: server-derived
-- "was-ever-admitted" signal so the patient waiting screen renders
-- correct copy (initial wait vs brief-hold) even after refresh /
-- device switch.
--
-- Applied to prod via Supabase MCP `apply_migration` on 2026-05-30
-- with name `031_first_admitted_at_audit`. Post-state confirmed via
-- direct re-query: col_present=1, col_type='timestamp with time
-- zone', sessions_set=0.
--
-- Background: PR #22 round 3 keyed the brief-hold copy on the
-- presence of cachedDailyArgs in PatientJoinClient state. Because we
-- mint the Daily token on consent submit (so post-admit transition
-- is instant), cachedDailyArgs is non-null IMMEDIATELY after consent
-- — which made the initial waiting screen show the brief-hold copy
-- ("Dr stepped out for a moment ... call will resume automatically")
-- on a first-ever join.
--
-- Fix: derive the signal from server state. consultation_sessions.
-- first_admitted_at is stamped once via COALESCE on the first
-- /api/doctor/admit-patient call; the admit-state and lobby-state
-- endpoints surface a derived boolean (wasEverAdmitted =
-- first_admitted_at IS NOT NULL). Survives refresh, survives device
-- switch, no localStorage scoping needed.
--
-- Symmetric with M030's consultation_participants.first_joined_at:
-- both are append-once audit timestamps that don't move once set.
-- doctor_admitted_at (M029) continues to be the LIVE flag — set on
-- admit, cleared on Send to Waiting; first_admitted_at is the
-- HISTORICAL flag — set once, immutable.
--
-- No backfill: existing rows (test sessions) have first_admitted_at
-- = NULL → wasEverAdmitted = false → initial-wait copy renders. If
-- the doctor admits one of those legacy sessions, first_admitted_at
-- lazily fills on the next admit POST. Matches M030's posture.
--
-- No index: queried by session id (PK) only. first_admitted_at is
-- never a filter, only a SELECT-projected audit field.
--
-- BEGIN/COMMIT stripped per M026-M030 convention — apply_migration
-- wraps its own transaction.

ALTER TABLE public.consultation_sessions
  ADD COLUMN IF NOT EXISTS first_admitted_at timestamptz;

COMMENT ON COLUMN public.consultation_sessions.first_admitted_at IS
  'Audit timestamp: the FIRST time the doctor clicked Admit on this session. Set once via COALESCE(first_admitted_at, now()) inside POST /api/doctor/admit-patient — immutable thereafter. Distinct from doctor_admitted_at (M029) which is the LIVE flag (cleared by Send to Waiting). Powers the patient-side waiting-screen copy split: NULL = initial-wait ("will admit you shortly"); non-null = brief-hold ("stepped out for a moment"). Symmetric with consultation_participants.first_joined_at (M030).';

-- Post-state sanity (single % per RAISE NOTICE — M022 lesson).
DO $$
DECLARE
  v_col_present     int;
  v_sessions_set    int;
BEGIN
  SELECT count(*) INTO v_col_present
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'consultation_sessions'
      AND column_name  = 'first_admitted_at';

  SELECT count(*) INTO v_sessions_set
    FROM public.consultation_sessions
    WHERE first_admitted_at IS NOT NULL;

  RAISE NOTICE 'M031: first_admitted_at column present = %', v_col_present;
  RAISE NOTICE 'M031: sessions w/ first_admitted_at set = %', v_sessions_set;
END $$;
