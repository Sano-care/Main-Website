-- M063: Duty-Room presence → auto-attendance for salaried doctors (C3)
--
-- The Consultation Platform's last open web slice. M032 (Ops Framework
-- Phase 1) shipped doctor_presence_log as schema-only — the WRITE was
-- explicitly deferred to "Phase 3". This migration is that write, plus the
-- presence→payroll bridge.
--
-- Two halves:
--
--   1. record_doctor_presence(doctor, ist_date) — the upsert the heartbeat
--      endpoint (/api/consultation/presence) calls via the service-role
--      client. INSERT-or-touch: first beat of the IST day stamps
--      first_login_at; every later beat only moves last_seen_at. The IST
--      calendar date is computed app-side (T51 formatIST → istDateISO) and
--      passed in, so presence_date is server-derived, never client-trusted,
--      and unit-testable across the IST-midnight boundary with a fixed clock.
--
--   2. The bridge — trg_doctor_presence_to_attendance fires on every
--      presence write. Once in-room minutes (last_seen_at − first_login_at)
--      cross the threshold AND the doctor is salaried, it creates the
--      doctor_attendance row. The EXISTING M4 trigger
--      (trg_doctor_attendance_earnings) then posts daily_wage = daily_wage_paise
--      for free. Freelancers are logged but never get an attendance row —
--      they earn per-booking, never a daily wage (M4 model).
--
-- Why a BEFORE trigger (deviation from the C3 brief's "AFTER"):
--   the bridge stamps NEW.attendance_auto_marked_at on the presence row to
--   make itself idempotent (so heartbeat #2..N don't re-evaluate). An
--   in-place NEW mutation only persists from a BEFORE row trigger; an AFTER
--   trigger would need a recursive self-UPDATE on doctor_presence_log. BEFORE
--   is the correct Postgres shape for "mutate the row being written + write a
--   side row". The attendance INSERT inside the trigger fires M4's AFTER
--   trigger synchronously, all inside the heartbeat's transaction.
--
-- Idempotency / double-post safety (belt and suspenders):
--   - attendance_auto_marked_at: once stamped, the bridge short-circuits.
--   - ON CONFLICT (doctor_id, work_date) DO NOTHING: if ops marked attendance
--     first (manual Mark-Present on /ops/doctors), the bridge's INSERT no-ops
--     — no duplicate row, no second wage. Same guard catches any heartbeat race.
--
-- SECURITY DEFINER + pinned search_path on both functions: the heartbeat
-- route calls record_doctor_presence via the service-role client (already
-- bypasses RLS), but pinning search_path is the safe convention for writing
-- functions and matches M058.

-- ---------------------------------------------------------------------
-- 1. Idempotency column
-- ---------------------------------------------------------------------
ALTER TABLE public.doctor_presence_log
  ADD COLUMN IF NOT EXISTS attendance_auto_marked_at timestamptz;

COMMENT ON COLUMN public.doctor_presence_log.attendance_auto_marked_at IS
  'Set by trg_doctor_presence_to_attendance the moment the presence→attendance bridge evaluates the salaried auto-mark for this (doctor, day). Non-null = bridge has already run; later heartbeats short-circuit. NULL for days that never crossed the threshold and for freelancers (who never auto-mark).';

-- ---------------------------------------------------------------------
-- 2. Presence upsert — called by the heartbeat endpoint (service role)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_doctor_presence(
  p_doctor_id     uuid,
  p_presence_date date
)
RETURNS public.doctor_presence_log
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.doctor_presence_log;
BEGIN
  INSERT INTO public.doctor_presence_log
    (doctor_id, presence_date, first_login_at, last_seen_at)
  VALUES
    (p_doctor_id, p_presence_date, now(), now())
  ON CONFLICT (doctor_id, presence_date)
  DO UPDATE SET last_seen_at = now()     -- first_login_at intentionally untouched
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.record_doctor_presence(uuid, date) IS
  'Heartbeat upsert for doctor_presence_log. First beat of the IST day inserts (first_login_at = last_seen_at = now()); later beats only advance last_seen_at. p_presence_date is the IST calendar date, computed app-side (formatIST/istDateISO) and passed in. Returns the live row so the endpoint can report minutes_present.';

-- ---------------------------------------------------------------------
-- 3. The bridge — presence → salaried attendance
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_attendance_on_presence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_min_minutes constant int := 30;   -- threshold; tunable via a one-line migration
  v_minutes     numeric;
  v_doctor_type text;
BEGIN
  -- Already evaluated for this (doctor, day) — nothing more to do. This is
  -- the primary idempotency guard: it makes heartbeat #2..N no-ops.
  IF NEW.attendance_auto_marked_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_minutes := EXTRACT(EPOCH FROM (NEW.last_seen_at - NEW.first_login_at)) / 60.0;
  IF v_minutes < v_min_minutes THEN
    RETURN NEW;   -- not enough in-room time yet
  END IF;

  SELECT doctor_type INTO v_doctor_type
  FROM public.doctors
  WHERE id = NEW.doctor_id;

  -- Freelancers: presence is logged for hours visibility, but they earn
  -- per-booking and never a daily wage — so no attendance row. Leave
  -- attendance_auto_marked_at NULL (the per-beat re-check is a single cheap
  -- SELECT; correctness over micro-optimisation).
  IF v_doctor_type IS DISTINCT FROM 'salaried' THEN
    RETURN NEW;
  END IF;

  -- Salaried + threshold crossed → create the attendance row. ON CONFLICT
  -- DO NOTHING is the double-post backstop: if ops already Mark-Present'd
  -- this (doctor, day), or two heartbeats race, the second one no-ops —
  -- no duplicate attendance, no second daily_wage. The existing M4 trigger
  -- trg_doctor_attendance_earnings posts the wage off the row we insert.
  INSERT INTO public.doctor_attendance
    (doctor_id, work_date, is_present, created_by, note)
  VALUES
    (NEW.doctor_id, NEW.presence_date, true, NULL, 'auto: duty-room presence ≥30m')
  ON CONFLICT (doctor_id, work_date) DO NOTHING;

  -- Stamp regardless of whether we inserted or hit the conflict — either way
  -- the question "should this day auto-mark?" is now settled. Prevents
  -- re-evaluation on every subsequent heartbeat.
  NEW.attendance_auto_marked_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.mark_attendance_on_presence() IS
  'Bridge: once doctor_presence_log in-room minutes cross 30 for a SALARIED doctor, create the doctor_attendance row (idempotent via attendance_auto_marked_at + ON CONFLICT). M4''s trg_doctor_attendance_earnings then posts daily_wage. Freelancers logged, never marked. BEFORE trigger so the in-place stamp persists.';

DROP TRIGGER IF EXISTS trg_doctor_presence_to_attendance ON public.doctor_presence_log;
CREATE TRIGGER trg_doctor_presence_to_attendance
  BEFORE INSERT OR UPDATE ON public.doctor_presence_log
  FOR EACH ROW
  EXECUTE FUNCTION public.mark_attendance_on_presence();

-- ---------------------------------------------------------------------
-- 4. Verify (RAISE NOTICE — house style, M032/M058)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_col      int;
  v_upsert   int;
  v_bridge   int;
  v_trigger  int;
BEGIN
  SELECT count(*) INTO v_col FROM information_schema.columns
    WHERE table_schema='public' AND table_name='doctor_presence_log'
      AND column_name='attendance_auto_marked_at';
  SELECT count(*) INTO v_upsert FROM pg_proc
    WHERE proname='record_doctor_presence';
  SELECT count(*) INTO v_bridge FROM pg_proc
    WHERE proname='mark_attendance_on_presence';
  SELECT count(*) INTO v_trigger FROM pg_trigger
    WHERE tgname='trg_doctor_presence_to_attendance';

  RAISE NOTICE 'M063: attendance_auto_marked_at column = %', v_col;
  RAISE NOTICE 'M063: record_doctor_presence fn        = %', v_upsert;
  RAISE NOTICE 'M063: mark_attendance_on_presence fn   = %', v_bridge;
  RAISE NOTICE 'M063: bridge trigger                   = %', v_trigger;

  IF v_col <> 1 OR v_upsert <> 1 OR v_bridge <> 1 OR v_trigger <> 1 THEN
    RAISE EXCEPTION 'M063 verify failed: col=% upsert=% bridge=% trigger=%',
      v_col, v_upsert, v_bridge, v_trigger;
  END IF;
END $$;
