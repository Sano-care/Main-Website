-- 030_first_joined_at_audit.sql
--
-- Consult Room v1 patch (PR #22 QA): preserve the original first-join
-- timestamp for audit before we start refreshing joined_at to now() on
-- every patient re-hit of /c/[token].
--
-- Applied to prod via Supabase MCP `apply_migration` on 2026-05-29
-- with name `030_first_joined_at_audit`. Post-state confirmed via
-- direct re-query (information_schema + count): col_present=1,
-- col_type='timestamp with time zone', parts_with_first=0.
--
-- Background: in v1 of PR #22, joined_at was set once on the very
-- first POST to /api/consultation/join/[token] and never updated.
-- Stale test-day rows (~95 hours old) surfaced as "Waiting: 5724:46"
-- on the doctor /doctor home — visually broken UX.
--
-- The post-patch behaviour will be:
--   - first_joined_at  = stamped once, on the first POST. Audit
--                        record of "patient was first present at X".
--                        Immutable thereafter (enforced in app layer
--                        via COALESCE(first_joined_at, now())).
--   - joined_at        = refreshed to now() on every POST. Drives
--                        the doctor's live wait counter and gates
--                        the PatientReadyCard listing (where a
--                        24h filter discards rows whose joined_at is
--                        older than 24h — kills stale state from
--                        prior test runs).
--
-- No backfill: existing rows already have joined_at set; the audit
-- record for those is "we did not have the column when they
-- consented" — NULL is the right value. Future POSTs to
-- /api/consultation/join from an existing patient will lazily fill
-- first_joined_at = now() on next hit, which is the same semantic as
-- "first time we tracked it".
--
-- No index: queried by session_id (existing idx_consultation_
-- participants_session covers it) and join_token (existing partial
-- unique index covers it). first_joined_at is never a query filter,
-- only a SELECT-projected audit field.
--
-- BEGIN/COMMIT stripped per M026/M027/M028/M029 convention —
-- apply_migration wraps its own transaction.

ALTER TABLE public.consultation_participants
  ADD COLUMN IF NOT EXISTS first_joined_at timestamptz;

COMMENT ON COLUMN public.consultation_participants.first_joined_at IS
  'Audit timestamp: the FIRST time this patient hit /c/[token] and POSTed /api/consultation/join. Set once via COALESCE(first_joined_at, now()) in the join handler — immutable thereafter. Sibling column joined_at is refreshed on every re-hit to drive the live "Waiting: mm:ss" counter on the doctor /doctor home (PR #22, M029). Backfill is intentionally absent: pre-M030 rows have first_joined_at = NULL because the column did not exist when they consented.';

-- Post-state sanity (single % per RAISE NOTICE — M022 lesson).
DO $$
DECLARE
  v_col_present      int;
  v_parts_with_first int;
BEGIN
  SELECT count(*) INTO v_col_present
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'consultation_participants'
      AND column_name  = 'first_joined_at';

  SELECT count(*) INTO v_parts_with_first
    FROM public.consultation_participants
    WHERE first_joined_at IS NOT NULL;

  RAISE NOTICE 'M030: first_joined_at column present = %', v_col_present;
  RAISE NOTICE 'M030: participants w/ first_joined_at set = %', v_parts_with_first;
END $$;
