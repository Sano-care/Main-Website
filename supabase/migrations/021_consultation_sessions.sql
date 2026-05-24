-- Migration 021 — C2: Teleconsultation flow + Zoom integration (schema)
--
-- Companion to the C2 build brief (Sanocare Consultation Platform).
-- Introduces the two operational tables that wrap the doctor's Zoom
-- Personal Meeting Room (PMI) — the "Duty Room" from C1 — into a
-- per-consult Sanocare object with a tokened patient-join link.
--
-- Architectural model (founder-decided, plan §3 + §6 C2):
--   * Each licensed Sanocare doctor has their own Zoom user account on
--     the Sanocare Pro/Business Zoom plan. Their Personal Meeting Room
--     (PMI) IS their Duty Room — fixed URL, always-on, stored on
--     doctors.duty_room_join_url (C1 migration 020).
--   * NO per-consult Zoom meeting is created. The patient's tokened
--     Sanocare URL resolves to the same PMI URL every time; the doctor
--     admits each patient from the Zoom waiting room, one at a time.
--   * Earning posts on the linked booking transitioning to COMPLETED.
--     M4's trg_bookings_doctor_earnings trigger is unchanged.
--
-- Schema introduced:
--   1. consultation_sessions
--      One row per consultation. Covers both teleconsultation (C2) and
--      vc_home_visit (C4) modalities via a CHECK constraint.
--      Two distinct consent fields, captured at different times:
--        - teleconsult_consent: the NMC Telemedicine Practice
--          Guidelines 2020 explicit-consent requirement. Captured in
--          C2 at the /c/[token] patient-join page, BEFORE the Zoom
--          redirect. Without this consent the patient cannot proceed.
--        - recording_consent: separate from teleconsult consent
--          because C2 runs on the free Zoom plan, which has NO cloud
--          recording. C2 NEVER writes to recording_consent; it stays
--          NULL on every C2 row. C3 (presence + recording) starts
--          populating this column once the Zoom plan is upgraded and
--          cloud recording is enabled.
--      Lifecycle timestamps (started_at / ended_at) are filled by C3
--      Zoom webhooks (meeting.started / meeting.ended). C2 leaves them
--      NULL and relies on the booking-side COMPLETED transition for
--      earning posts.
--
--   2. consultation_participants
--      One row per (session, person). Patient rows carry the unique
--      join_token used in the /c/[token] WhatsApp link. Doctor and
--      medic rows are bookkeeping — the doctor enters via the C1
--      /doctor portal; the medic via the C4 native Android app.
--      join_token is 32 hex chars (16 random bytes) — same format as
--      bookings.report_unlock_token (M008). Reusable until
--      join_token_expires_at (so the patient can re-tap their WhatsApp
--      link after a network hiccup) but tracked via joined_at for
--      audit. C3 will set left_at via meeting.participant_left.
--
-- RLS posture (A1, same as C1):
--   ops_users get SELECT/INSERT/UPDATE on both tables via is_ops_user().
--   There is NO Postgres-level "doctor" role in C2. The doctor surface
--   reads these tables through src/app/doctor/_lib/ accessors that
--   scope queries by getCurrentDoctor().id via the service-role client
--   — the same enforcement boundary as the C1 doctor ledger view.
--   The patient join page reads consultation_participants by
--   join_token via the service-role client — the token IS the auth
--   (no Supabase user session in the patient path), mirroring
--   /reports/[token] from M2.7.
--
-- Operational notes (these are NOT enforced by DDL — they're
-- founder/ops responsibilities tied to the Zoom-side setup):
--   * The doctor must be SIGNED INTO Zoom on their PMI as their
--     licensed Sanocare Zoom user for the host + admit-from-waiting-
--     room flow to work. Signed in to a different Zoom account =
--     patient sees "waiting for host" indefinitely. The /doctor home
--     should remind the doctor of this before the Enter Duty Room
--     button (C2 build).
--   * The ops doctor-onboarding "Auto-fill Duty Room from Zoom"
--     action (C2 build) keys on doctors.email matching the licensed
--     Zoom user's email — GET /users/{userId} on the Zoom REST API
--     accepts an email as the userId. doctors.email therefore must
--     equal the doctor's licensed Zoom user email; otherwise the
--     auto-fill returns 404 and ops falls back to the C1 hand-paste.
--
-- Not touched:
--   * bookings — teleconsult bookings reuse the existing
--     service_category = 'teleconsult' value; no schema change.
--   * doctors / doctor_attendance / doctor_ledger_entries / M4
--     earning triggers — all unchanged.
--   * customers / otp_verifications / partners / ops_users.
--   * Bookings RLS — kept on the separate security cleanup task per
--     Step 0 review.
--   * M003 service_category CHECK constraint + legacy backfill —
--     kept on the separate service-category cleanup task per Step 0
--     review.
--
-- Idempotent: safe to re-run on a clean install. The CREATE TABLE IF
-- NOT EXISTS / CREATE INDEX IF NOT EXISTS / DROP POLICY IF EXISTS +
-- CREATE POLICY pattern matches M019 and M020.

-- =====================================================================
-- 0. PRE-FLIGHT: confirm is_ops_user() exists
-- =====================================================================
-- M012 introduced public.is_ops_user(); every RLS-bearing migration
-- since has assumed it. Fail fast with a useful diagnostic if it's
-- missing — better than CREATE POLICY succeeding against a phantom
-- function and silently denying every access.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public' AND p.proname = 'is_ops_user'
  ) THEN
    RAISE EXCEPTION
      'Migration 021 aborted: public.is_ops_user() not found. Run migration 012 (ops_users) first.';
  END IF;
END $$;

-- =====================================================================
-- 1. consultation_sessions
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.consultation_sessions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 1:1 link to the source booking. UNIQUE so a booking cannot have two
  -- consultation sessions. ON DELETE RESTRICT prevents losing
  -- consultation history if a booking is ever deleted; combined with
  -- the bookings table's own append-only posture this means a session
  -- row is effectively as permanent as a ledger entry.
  booking_id               uuid NOT NULL UNIQUE
                           REFERENCES public.bookings(id) ON DELETE RESTRICT,
  -- The doctor hosting. ON DELETE RESTRICT mirrors how
  -- doctor_ledger_entries.doctor_id is locked (M019) — a doctor with
  -- consultation history cannot be deleted; soft-delete via
  -- doctors.is_active = false is the supported path.
  doctor_id                uuid NOT NULL
                           REFERENCES public.doctors(id) ON DELETE RESTRICT,
  -- Modality. Lives here (not on bookings) so vc_home_visit (C4) can
  -- reuse this table without another booking-side schema change.
  modality                 text NOT NULL
                           CHECK (modality IN ('teleconsultation','vc_home_visit')),
  -- Lifecycle status. C2 only writes 'scheduled' (on create) and
  -- 'cancelled' (if ops cancels). 'waiting' / 'in_progress' /
  -- 'completed' are written by C3 webhook handlers (meeting.started /
  -- participant.joined / meeting.ended).
  status                   text NOT NULL DEFAULT 'scheduled'
                           CHECK (status IN
                             ('scheduled','waiting','in_progress','completed','cancelled')),
  -- The doctor's PMI URL captured at session-create time. Denormalised
  -- here so later edits to doctors.duty_room_join_url don't
  -- retroactively re-point old sessions. NULL means "doctor's PMI
  -- wasn't set up at create time" — the /c/[token] page surfaces a
  -- graceful fallback in that case.
  zoom_join_url            text,
  -- PMI number as text (e.g. "1234567890"). Forward-compat — C3 will
  -- populate from Zoom webhook payloads (meeting.uuid + meeting.id).
  -- Kept as text so we are not bound to Zoom's id format.
  zoom_meeting_id          text,
  -- Patient consent to the TELECONSULTATION itself. NMC Telemedicine
  -- Practice Guidelines 2020: explicit consent is mandatory before a
  -- remote doctor can provide consultation. Captured at the
  -- /c/[token] join page BEFORE the redirect to Zoom — without it the
  -- patient cannot proceed. NULL = not yet asked; true = consented;
  -- false = explicit refusal (no consult, status transitions to
  -- 'cancelled' with reason).
  teleconsult_consent      boolean,
  teleconsult_consent_at   timestamptz,
  -- Patient consent to RECORDING. RESERVED FOR C3 — not touched by C2
  -- code. C2 runs on the free Zoom plan which has no cloud recording,
  -- so there is nothing to consent to yet. Kept nullable here so C3
  -- needs no column-add; C3 will start populating this when the Zoom
  -- plan is upgraded and the recording_consent UI is added to
  -- /c/[token].
  recording_consent        boolean,
  recording_consent_at     timestamptz,
  -- Lifecycle timestamps.
  --   scheduled_at: the planned consultation time (often mirrors
  --                 bookings.scheduled_for). Defaults to now() for
  --                 ad-hoc sessions created on the spot.
  --   started_at / ended_at: filled by C3 webhooks
  --                 (meeting.started / meeting.ended). C2 leaves them
  --                 NULL; the earning trigger fires on the booking's
  --                 status = 'COMPLETED' transition, not on this row.
  scheduled_at             timestamptz NOT NULL DEFAULT now(),
  started_at               timestamptz,
  ended_at                 timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  -- Set on ops-created sessions; NULL if a system-created path arrives
  -- later (none in C2 — every session in C2 is created by an ops user
  -- via /ops/bookings/new or the teleconsult-specific extension of it).
  created_by               uuid REFERENCES public.ops_users(id) ON DELETE SET NULL
);

-- Composite index covering the doctor's home-queue query
-- ("upcoming + waiting sessions for me, sorted by time"):
--   WHERE doctor_id = $1 AND status IN ('scheduled','waiting')
--   ORDER BY scheduled_at ASC
CREATE INDEX IF NOT EXISTS idx_consultation_sessions_doctor_status_scheduled
  ON public.consultation_sessions (doctor_id, status, scheduled_at);

-- booking_id is already UNIQUE -> btree index is auto-created; no
-- separate idx_consultation_sessions_booking needed.

COMMENT ON TABLE public.consultation_sessions IS
  'One row per consultation. C2 covers the teleconsultation modality (patient + doctor, both remote, doctor''s Zoom PMI = Duty Room). C4 adds vc_home_visit. Earning posts on the LINKED booking when its status transitions to COMPLETED — M4''s trg_bookings_doctor_earnings is unchanged; this table is not on the earning path.';

COMMENT ON COLUMN public.consultation_sessions.zoom_join_url IS
  'Doctor''s PMI join URL captured at session-create time (snapshot of doctors.duty_room_join_url at the moment of create). Denormalised so later doctor.duty_room_join_url changes do not retroactively re-point old sessions.';

COMMENT ON COLUMN public.consultation_sessions.teleconsult_consent IS
  'Patient''s consent to the teleconsultation itself, per NMC Telemedicine Practice Guidelines 2020. Captured at /c/[token] BEFORE the Zoom redirect. NULL = not yet answered; true = consented and proceeded; false = explicit refusal (session transitions to cancelled).';

COMMENT ON COLUMN public.consultation_sessions.recording_consent IS
  'RESERVED FOR C3. C2 runs on the free Zoom plan with no cloud recording, so this column is NEVER written by C2 code paths. C3 will start populating this when cloud recording is enabled and the recording-consent UI is added to /c/[token].';

-- =====================================================================
-- 2. consultation_participants
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.consultation_participants (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE: deleting a session deletes its participants. The session
  -- itself is protected by ON DELETE RESTRICT on its FKs, so this
  -- cascade only fires in legitimate test-cleanup paths.
  session_id               uuid NOT NULL
                           REFERENCES public.consultation_sessions(id) ON DELETE CASCADE,
  role                     text NOT NULL
                           CHECK (role IN ('doctor','patient','medic')),
  -- Patient participants link to a customer when one exists; doctor
  -- and medic participants leave this NULL (the doctor identity is
  -- already on consultation_sessions.doctor_id; medics arrive in C4
  -- and key off a separate paramedic table).
  customer_id              uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  -- 32-hex random join token (16 random bytes via crypto.randomBytes).
  -- PATIENT participants only — doctor enters their PMI via /doctor;
  -- medic enters via the C4 native Android app. The UNIQUE partial
  -- index below enforces uniqueness only where the token is set, so
  -- doctor / medic rows with NULL tokens don't collide.
  --
  -- Format mirrors bookings.report_unlock_token (M008): URL-safe
  -- 32-char hex, validated app-side via the same isValidTokenFormat()
  -- shape.
  join_token               text,
  join_token_expires_at    timestamptz,
  -- Set when the patient first hits /c/[token]. NOT consumed on use —
  -- the token is reusable until join_token_expires_at so a patient
  -- can re-tap their WhatsApp link after a network hiccup or page
  -- refresh. Audit-only here.
  joined_at                timestamptz,
  -- C3 webhook (meeting.participant_left) will populate this. NULL in
  -- C2.
  left_at                  timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consultation_participants_session
  ON public.consultation_participants (session_id);

-- Partial UNIQUE index on join_token. Tokens are present on patient
-- rows only; doctor / medic rows have NULL and must not collide.
-- Partial UNIQUE (... WHERE join_token IS NOT NULL) is the standard
-- Postgres pattern for this — NULLs are excluded from the uniqueness
-- check entirely.
CREATE UNIQUE INDEX IF NOT EXISTS consultation_participants_token_unique
  ON public.consultation_participants (join_token)
  WHERE join_token IS NOT NULL;

COMMENT ON TABLE public.consultation_participants IS
  'One row per (session, person). Patient rows carry the unique tokened join link delivered via Rampwin WhatsApp; doctor + medic rows are bookkeeping. The doctor enters their Duty Room from /doctor (no token); the medic enters from the C4 Android app (no token in this table either).';

COMMENT ON COLUMN public.consultation_participants.join_token IS
  '32-hex random token (16 random bytes) for patient participants only. The patient''s /c/[token] page resolves through this column via the service-role client — no auth session involved; the token IS the auth (mirrors bookings.report_unlock_token, M008). Reusable until join_token_expires_at; not consumed on use.';

-- =====================================================================
-- 3. RLS
-- =====================================================================
-- Ops policies only — same posture as the M-series. Doctors do not get
-- a Postgres-level role; their reads go through service-role accessors
-- in src/app/doctor/_lib/ that scope by getCurrentDoctor().id (A1
-- enforcement, identical to C1). The patient /c/[token] handler also
-- uses service-role + join_token lookup; service-role bypasses RLS so
-- these policies have no effect on that path.

ALTER TABLE public.consultation_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_participants ENABLE ROW LEVEL SECURITY;

-- ---- consultation_sessions ----
DROP POLICY IF EXISTS "consultation_sessions readable by ops" ON public.consultation_sessions;
CREATE POLICY "consultation_sessions readable by ops"
  ON public.consultation_sessions FOR SELECT TO authenticated
  USING (public.is_ops_user());

DROP POLICY IF EXISTS "consultation_sessions insertable by ops" ON public.consultation_sessions;
CREATE POLICY "consultation_sessions insertable by ops"
  ON public.consultation_sessions FOR INSERT TO authenticated
  WITH CHECK (public.is_ops_user());

DROP POLICY IF EXISTS "consultation_sessions updatable by ops" ON public.consultation_sessions;
CREATE POLICY "consultation_sessions updatable by ops"
  ON public.consultation_sessions FOR UPDATE TO authenticated
  USING (public.is_ops_user()) WITH CHECK (public.is_ops_user());

-- No DELETE policy. To "cancel" a session, set status = 'cancelled'.

-- ---- consultation_participants ----
DROP POLICY IF EXISTS "consultation_participants readable by ops" ON public.consultation_participants;
CREATE POLICY "consultation_participants readable by ops"
  ON public.consultation_participants FOR SELECT TO authenticated
  USING (public.is_ops_user());

DROP POLICY IF EXISTS "consultation_participants insertable by ops" ON public.consultation_participants;
CREATE POLICY "consultation_participants insertable by ops"
  ON public.consultation_participants FOR INSERT TO authenticated
  WITH CHECK (public.is_ops_user());

DROP POLICY IF EXISTS "consultation_participants updatable by ops" ON public.consultation_participants;
CREATE POLICY "consultation_participants updatable by ops"
  ON public.consultation_participants FOR UPDATE TO authenticated
  USING (public.is_ops_user()) WITH CHECK (public.is_ops_user());

-- No DELETE policy on consultation_participants either — append-only
-- bookkeeping like the M4 ledger.

-- =====================================================================
-- 4. Sanity summary (visible in the Messages panel)
-- =====================================================================
DO $$
DECLARE
  v_sessions_count integer;
  v_parts_count    integer;
BEGIN
  SELECT count(*) INTO v_sessions_count FROM public.consultation_sessions;
  SELECT count(*) INTO v_parts_count    FROM public.consultation_participants;
  RAISE NOTICE 'Migration 021 complete: consultation_sessions has % row(s), consultation_participants has % row(s). RLS enabled on both, ops-only policies installed, NO doctor-role DB policies (A1 scoping enforced in app layer).',
    v_sessions_count, v_parts_count;
END $$;
