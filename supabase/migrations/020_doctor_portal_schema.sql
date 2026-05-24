-- Migration 020 — C1: Doctor portal + doctor auth — schema additions
--
-- Companion to the C1 build brief (Sanocare Consultation Platform). Adds
-- the minimum schema needed to:
--   * Let doctors log in by phone + OTP (mirrors the patient flow at
--     /api/auth/{send,verify}-otp — custom HMAC-SHA256 JWT + HttpOnly
--     cookie, NOT Supabase Auth). Phone is the login key, so it has to
--     be canonical and collision-free.
--   * Store each doctor's fixed Zoom Duty Room link (ops pastes it).
--   * Reserve zoom_user_id for C2 (Zoom REST API integration) so a
--     later phase doesn't need a separate migration just for one column.
--
-- Schema changes:
--   1. doctors.phone — backfill via normalise_indian_phone() (M016 helper),
--      then add a UNIQUE index. NULLs are intentionally allowed (UNIQUE
--      treats them as distinct in Postgres) — a doctor record can exist
--      before they're cleared for the portal; a NULL-phone doctor simply
--      can't log in until ops assigns one.
--   2. doctors.duty_room_join_url text NULL — the Zoom Personal Meeting
--      Room link, populated by an ops admin via /ops/doctors. NULL is the
--      "not set up yet" state and the /doctor home shows a graceful
--      fallback.
--   3. doctors.zoom_user_id text NULL — reserved for C2 (S2S OAuth /
--      meeting management). Not populated by anything in C1.
--
-- RLS:
--   C1's doctor session is a custom HMAC-SHA256 JWT in an HttpOnly cookie,
--   not a Supabase Auth identity. There is no auth.uid() for a doctor, so
--   a USING (auth.uid() = ...) policy has nothing to compare against. The
--   /doctor pages run via the service-role Supabase client (RLS-bypassing)
--   and getCurrentDoctor() always supplies the WHERE doctor_id = ... scope
--   — that is the enforcement boundary in C1. The brief's API-level test
--   ("signed in as doctor A, you cannot read doctor B's row or ledger")
--   passes because the doctor-facing data accessors only accept the
--   doctor_id baked into the verified cookie — no caller-supplied id is
--   ever honoured.
--
--   The M019 ops policies on doctors / doctor_attendance /
--   doctor_ledger_entries (is_ops_user / is_ops_admin) are NOT touched —
--   they continue to gate /ops exactly as before. This migration does
--   not loosen any existing policy.
--
-- Not touched:
--   * doctor_attendance, doctor_ledger_entries (structure and policies)
--   * M019 earning triggers (post_doctor_earnings_*, post_overtime_*)
--   * customers, bookings, otp_verifications
--
-- Idempotent: safe to re-run on a clean install.

-- =====================================================================
-- 0. PRE-FLIGHT: duplicate phones across doctors
-- =====================================================================
-- M016 auto-merged duplicate CUSTOMERS by phone (oldest wins, repoint
-- bookings, delete losers). We deliberately do NOT auto-merge doctors:
-- a doctor row is a heavier object (ledger history, attendance, future
-- bookings.doctor_id rows) and silently picking a "winner" is the wrong
-- default. Instead, abort with a useful diagnostic if any collisions
-- exist *after* normalisation. The operator resolves manually (NULL one
-- side, fix typos, merge by hand) and re-runs.

DO $$
DECLARE
  r record;
  v_dup_count integer := 0;
BEGIN
  FOR r IN
    WITH normalised AS (
      SELECT id, doctor_code, full_name,
             public.normalise_indian_phone(phone) AS np
      FROM public.doctors
      WHERE phone IS NOT NULL
    )
    SELECT np,
           count(*) AS n,
           string_agg(doctor_code || ' (' || full_name || ')', ', ') AS who
    FROM normalised
    GROUP BY np
    HAVING count(*) > 1
  LOOP
    RAISE NOTICE 'Duplicate doctor phone after normalisation: % -> %', r.np, r.who;
    v_dup_count := v_dup_count + 1;
  END LOOP;
  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'Migration 020 aborted: % doctor phone group(s) collide after E.164 normalisation (see NOTICE rows above). Resolve manually (NULL one side, fix typos, or merge records before any ledger history accrues) and re-run.',
      v_dup_count;
  END IF;
END $$;

-- =====================================================================
-- 1. Normalise existing doctors.phone to E.164 (in place)
-- =====================================================================
-- normalise_indian_phone() (M016) returns the original string unchanged
-- for anything not recognisable as an Indian mobile — never silently
-- destroys data. The WHERE filter makes this a true no-op on re-run.

UPDATE public.doctors
   SET phone = public.normalise_indian_phone(phone)
 WHERE phone IS NOT NULL
   AND phone <> public.normalise_indian_phone(phone);

-- =====================================================================
-- 2. UNIQUE index on doctors.phone
-- =====================================================================
-- NULLs are intentionally allowed (UNIQUE treats NULLs as distinct in
-- Postgres). A doctor can exist without a phone; they just can't log in
-- to /doctor until ops assigns one.

CREATE UNIQUE INDEX IF NOT EXISTS doctors_phone_unique
  ON public.doctors (phone);

COMMENT ON INDEX public.doctors_phone_unique IS
  'Enforces one doctor row per phone. NULL phones permitted (UNIQUE treats NULLs as distinct in Postgres). All app-side INSERT/UPDATE paths must call normalise_indian_phone() first to keep the constraint useful — same contract as customers_phone_unique (M016).';

-- =====================================================================
-- 3. doctors.duty_room_join_url — Zoom Duty Room link
-- =====================================================================
ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS duty_room_join_url text;

COMMENT ON COLUMN public.doctors.duty_room_join_url IS
  'The doctor''s fixed Zoom Personal Meeting Room (Duty Room) join URL. NULL = not yet set up; /doctor home shows a graceful fallback ("Your Duty Room isn''t set up yet"). Populated by an ops admin via /ops/doctors. The full Zoom REST API integration arrives in C2.';

-- =====================================================================
-- 4. doctors.zoom_user_id — reserved for C2
-- =====================================================================
-- The doctor's Zoom user id (target of S2S OAuth meeting-management
-- calls). Not populated in C1; carried here so C2 doesn't need a
-- one-column migration. Kept as text so we're not bound to any specific
-- Zoom id format until C2 confirms.

ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS zoom_user_id text;

COMMENT ON COLUMN public.doctors.zoom_user_id IS
  'The doctor''s Zoom user id (target of S2S OAuth meeting-management calls). Reserved for C2 — NOT written by any C1 code path.';

-- =====================================================================
-- 5. RLS — UNCHANGED on purpose
-- =====================================================================
-- See header. C1 enforces per-doctor scoping in the server layer
-- (getCurrentDoctor() + WHERE doctor_id = $session_doctor_id via the
-- service-role client). No new DB-level policies are introduced for a
-- "doctor" role, because there is no Postgres-level doctor role in this
-- phase. The M019 ops policies remain authoritative for /ops access.

-- =====================================================================
-- 6. Sanity summary (visible in the Messages panel)
-- =====================================================================
DO $$
DECLARE
  v_total       integer;
  v_with_phone  integer;
  v_with_room   integer;
BEGIN
  SELECT count(*) INTO v_total      FROM public.doctors;
  SELECT count(*) INTO v_with_phone FROM public.doctors WHERE phone IS NOT NULL;
  SELECT count(*) INTO v_with_room  FROM public.doctors WHERE duty_room_join_url IS NOT NULL;
  RAISE NOTICE 'Migration 020 complete: % doctor row(s) total, % with a normalised phone (eligible for /doctor login), % with duty_room_join_url set.',
    v_total, v_with_phone, v_with_room;
END $$;
