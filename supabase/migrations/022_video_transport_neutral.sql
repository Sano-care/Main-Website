-- Migration 022 — C2-V: Transport-neutral column names for the video layer
--
-- Companion to the C2-V build brief (Sanocare Consultation Platform —
-- video transport swap from Zoom to Daily.co). The schema introduced by
-- C2 (M021) embedded Zoom-specific column names. C2-V keeps the column
-- semantics identical — they still hold "the doctor's Duty Room URL"
-- and "the snapshot of that URL at session-create time" — but the names
-- become transport-neutral so a future swap (Daily -> Jitsi, etc.)
-- doesn't require renaming again.
--
-- Decision boundary: C2 ships Zoom Personal Meeting Room URLs in these
-- columns; C2-V will overwrite them with Daily.co room URLs once the
-- per-doctor Daily room provisioning lands. The migration is rename-
-- only (no data transformation) — existing rows keep their (now stale)
-- Zoom URLs until the C2-V app code overwrites them. The two in-flight
-- teleconsult sessions on prod are being cancelled Sanocare-side before
-- this deploy (per the C2-V Step 0 review).
--
-- Changes:
--   1. doctors.zoom_user_id            -> doctors.duty_room_provider_ref
--      Was reserved for Zoom's user-id (string from /users/{userId}).
--      Now: opaque identifier the transport uses to reference a room.
--      For Daily.co, this stores room.name (e.g. "sano-d-00001-duty-
--      room") which is required when minting Daily meeting tokens.
--      Transport-neutral name -- a later swap (Jitsi room id, Whereby
--      room key, ...) would reuse the same column.
--
--   2. consultation_sessions.zoom_join_url -> consultation_sessions.duty_room_url_snapshot
--      Was the snapshot of the doctor's PMI URL at session-create time.
--      Same semantics under Daily — snapshot of doctors.duty_room_join_url
--      at insert. The new name mirrors duty_room_join_url and drops the
--      Zoom-specific prefix.
--
--   3. consultation_sessions.zoom_meeting_id  ->  DROPPED
--      Was reserved for Zoom's per-meeting id, never written by any
--      C2 code path, intended for C3's webhook correlation. Under
--      Daily, webhook correlation uses room.name + meeting_session_id —
--      different shape entirely. C3-V will introduce whichever column
--      it needs concretely; preserving a Zoom-shaped reservation in
--      C2-V would mislead future readers.
--
-- Not renamed:
--   * doctors.duty_room_join_url — already transport-neutral. C2-V
--     overwrites the Zoom PMI URL with a Daily room URL when ops
--     clicks "Provision Duty Room (Daily)" on /ops/doctors/[id].
--   * Everything else on doctors / consultation_sessions /
--     consultation_participants — unchanged. The booking flow, the
--     join-token model, the consent fields, the M4 earning trigger,
--     and the A1 scoped-accessor pattern are transport-agnostic and
--     stay put.
--
-- Postgres mechanics:
--   ALTER TABLE ... RENAME COLUMN is a metadata-only operation — it
--   updates pg_attribute, doesn't rewrite any rows, and doesn't take
--   an ACCESS EXCLUSIVE lock for long (microseconds on a small table).
--   The DROP COLUMN ... IF EXISTS is similarly cheap.
--
-- Idempotency: wrapped in DO blocks that check information_schema
-- before each rename so re-runs against an already-migrated DB are
-- no-ops. DROP COLUMN IF EXISTS is natively idempotent. Re-runnable.

-- =====================================================================
-- 1. Rename doctors.zoom_user_id -> doctors.duty_room_provider_ref
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'doctors'
      AND column_name  = 'zoom_user_id'
  ) THEN
    ALTER TABLE public.doctors
      RENAME COLUMN zoom_user_id TO duty_room_provider_ref;
    RAISE NOTICE 'doctors.zoom_user_id renamed -> duty_room_provider_ref';
  ELSE
    RAISE NOTICE 'doctors.zoom_user_id not present — assuming already renamed; skipping';
  END IF;
END $$;

-- =====================================================================
-- 2. Rename consultation_sessions.zoom_join_url -> duty_room_url_snapshot
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'consultation_sessions'
      AND column_name  = 'zoom_join_url'
  ) THEN
    ALTER TABLE public.consultation_sessions
      RENAME COLUMN zoom_join_url TO duty_room_url_snapshot;
    RAISE NOTICE 'consultation_sessions.zoom_join_url renamed -> duty_room_url_snapshot';
  ELSE
    RAISE NOTICE 'consultation_sessions.zoom_join_url not present — assuming already renamed; skipping';
  END IF;
END $$;

-- =====================================================================
-- 3. Drop consultation_sessions.zoom_meeting_id
-- =====================================================================
-- Reserved by C2 (M021) for Zoom webhook correlation; never written by
-- any C2 code path. C3-V will introduce concrete columns for Daily
-- webhook correlation (room name + meeting_session_id) when those
-- payloads start arriving; we don't preserve a Zoom-shaped reservation.

ALTER TABLE public.consultation_sessions
  DROP COLUMN IF EXISTS zoom_meeting_id;

-- =====================================================================
-- 4. Refreshed COMMENTs documenting Daily.co + the transport-neutral
--    intent. Safe to run multiple times.
-- =====================================================================

COMMENT ON COLUMN public.doctors.duty_room_provider_ref IS
  'Opaque identifier the video transport uses to reference the doctor''s Duty Room. For Daily.co (C2-V), this stores room.name (e.g. "sano-d-00001-duty-room") and is used server-side when minting meeting tokens. Transport-neutral name — a later swap (Jitsi room id, Whereby room key, etc.) would reuse this column without renaming.';

COMMENT ON COLUMN public.doctors.duty_room_join_url IS
  'The URL the doctor or patient opens to enter the Duty Room. Transport-neutral. For Daily.co (C2-V), this is room.url (e.g. https://sanocare.daily.co/sano-d-00001-duty-room). Snapshotted onto consultation_sessions.duty_room_url_snapshot at session-create time so later edits here do not retroactively re-point old sessions.';

COMMENT ON COLUMN public.consultation_sessions.duty_room_url_snapshot IS
  'Doctor''s Duty Room URL captured at session-create time (snapshot of doctors.duty_room_join_url at the moment of insert). Renamed from zoom_join_url in M022 — semantics identical, name now transport-neutral.';

-- =====================================================================
-- 5. Sanity summary (visible in the Messages panel)
-- =====================================================================
DO $$
DECLARE
  v_doctors_with_provider integer;
  v_doctors_with_url      integer;
  v_sessions_with_url     integer;
  v_meeting_id_present    boolean;
BEGIN
  SELECT count(*) INTO v_doctors_with_provider
    FROM public.doctors WHERE duty_room_provider_ref IS NOT NULL;
  SELECT count(*) INTO v_doctors_with_url
    FROM public.doctors WHERE duty_room_join_url IS NOT NULL;
  SELECT count(*) INTO v_sessions_with_url
    FROM public.consultation_sessions WHERE duty_room_url_snapshot IS NOT NULL;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='consultation_sessions'
      AND column_name='zoom_meeting_id'
  ) INTO v_meeting_id_present;

  RAISE NOTICE 'Migration 022 complete:';
  RAISE NOTICE '  doctors.duty_room_provider_ref populated on %% row(s)', v_doctors_with_provider;
  RAISE NOTICE '  doctors.duty_room_join_url populated on %% row(s) (legacy Zoom URLs until C2-V overwrites)', v_doctors_with_url;
  RAISE NOTICE '  consultation_sessions.duty_room_url_snapshot populated on %% row(s) (legacy Zoom URLs, expected ~0 after Sanocare-side cancel)', v_sessions_with_url;
  RAISE NOTICE '  consultation_sessions.zoom_meeting_id still present: %% (expected: false)', v_meeting_id_present;
END $$;
