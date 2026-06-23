-- Medic payroll — M4-clone onto medics (freelancer/salaried) + selfie-gated daily wage.
--
-- Mirrors the verified doctor M019 engine: doctors→medics, doctor_id→medic_id,
-- doctor_type→medic_type, doctor_attendance→medic_attendance (existing table,
-- ALTERed in place), doctor_ledger_entries→medic_ledger_entries (existing). The
-- ledger entry_type CHECK already allows revenue_share/commission/daily_wage/
-- overtime/payout/adjustment/reversal — no CHECK change needed.
--
-- Founder decisions 2026-06-22 (A1 · B1 · C1):
--   A1 — RLS on medics / medic_attendance / medic_ledger_entries is UNCHANGED
--        (stays off). The money path is secured by the SECURITY DEFINER accrual
--        triggers + admin/service-role writes. RLS-hardening is a separate
--        fast-follow, deliberately out of scope here.
--   B1 — NO strict pay-terms CHECK (unlike doctors). Existing medics have NULL
--        rates; the accrual COALESCEs missing rates to 0, so nothing pays until
--        ops configures them. Type↔rate integrity is enforced in the ops UI.
--   C1 — completed LAB bookings (service_category in lab/lab-tests/diagnostics)
--        yield NO medic revenue_share or commission. Conservative guard beyond the
--        literal doctor clone — medics, unlike doctors, can be on lab bookings.
--
-- Selfie gate (the one behavioral change from the doctor engine): daily_wage /
-- overtime post only when medic_attendance.selfie_verified_at IS NOT NULL. The
-- Aarogya selfie flow sets that flag (separate marketing brief); until it lands,
-- ops set it manually. A bare clock-in never posts a daily wage.
--
-- Applied via Supabase MCP (recorded version 20260622163258); this file's name
-- equals that version for repo↔DB parity. Timestamp convention per the workspace
-- house rule (never sequential 0NN_).
--
-- Reversibility:
--   DROP TRIGGER IF EXISTS trg_medic_attendance_earnings ON public.medic_attendance;
--   DROP TRIGGER IF EXISTS trg_bookings_medic_earnings ON public.bookings;
--   DROP FUNCTION IF EXISTS public.post_medic_earnings_on_attendance();
--   DROP FUNCTION IF EXISTS public.post_medic_earnings_on_booking();
--   ALTER TABLE public.medic_attendance DROP CONSTRAINT IF EXISTS medic_attendance_medic_work_date_unique;
--   ALTER TABLE public.medic_attendance
--     DROP COLUMN IF EXISTS overtime_amount_paise, DROP COLUMN IF EXISTS overtime_hours,
--     DROP COLUMN IF EXISTS selfie_verified_at, DROP COLUMN IF EXISTS is_present,
--     DROP COLUMN IF EXISTS work_date;
--   ALTER TABLE public.medics
--     DROP COLUMN IF EXISTS pay_notes, DROP COLUMN IF EXISTS overtime_hourly_paise,
--     DROP COLUMN IF EXISTS commission_per_visit_paise, DROP COLUMN IF EXISTS daily_wage_paise,
--     DROP COLUMN IF EXISTS revenue_share_pct, DROP COLUMN IF EXISTS medic_type;

-- =====================================================================
-- 0. PRE-FLIGHT (cloned from M019): abort if bookings.status isn't uppercase,
--    since the earning trigger compares status = 'COMPLETED'.
-- =====================================================================
DO $$
DECLARE
  r record;
  v_mismatch_count integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT status FROM public.bookings
    WHERE status IS NOT NULL AND status <> upper(status)
  LOOP
    RAISE NOTICE 'Non-uppercase bookings.status detected: %', quote_literal(r.status);
    v_mismatch_count := v_mismatch_count + 1;
  END LOOP;
  IF v_mismatch_count > 0 THEN
    RAISE EXCEPTION
      'medic_payroll aborted: bookings.status has % distinct non-uppercase value(s). The earning trigger compares status = ''COMPLETED''. Resolve the drift, then re-run.',
      v_mismatch_count;
  END IF;
END $$;

-- =====================================================================
-- 1. Medic payout config (mirror doctors; B1 = no pay-terms CHECK)
-- =====================================================================
ALTER TABLE public.medics
  ADD COLUMN IF NOT EXISTS medic_type text NOT NULL DEFAULT 'salaried'
    CHECK (medic_type IN ('freelancer','salaried')),
  ADD COLUMN IF NOT EXISTS revenue_share_pct numeric(5,2)
    CHECK (revenue_share_pct IS NULL OR (revenue_share_pct >= 0 AND revenue_share_pct <= 100)),
  ADD COLUMN IF NOT EXISTS daily_wage_paise integer
    CHECK (daily_wage_paise IS NULL OR daily_wage_paise >= 0),
  ADD COLUMN IF NOT EXISTS commission_per_visit_paise integer
    CHECK (commission_per_visit_paise IS NULL OR commission_per_visit_paise >= 0),
  ADD COLUMN IF NOT EXISTS overtime_hourly_paise integer
    CHECK (overtime_hourly_paise IS NULL OR overtime_hourly_paise >= 0),
  ADD COLUMN IF NOT EXISTS pay_notes text;

-- =====================================================================
-- 2. Day-level attendance + selfie gate (ALTER existing medic_attendance)
-- =====================================================================
ALTER TABLE public.medic_attendance
  ADD COLUMN IF NOT EXISTS work_date date,
  ADD COLUMN IF NOT EXISTS is_present boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS selfie_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS overtime_hours numeric(5,2)
    CHECK (overtime_hours IS NULL OR overtime_hours >= 0),
  ADD COLUMN IF NOT EXISTS overtime_amount_paise integer
    CHECK (overtime_amount_paise IS NULL OR overtime_amount_paise >= 0);

-- Backfill work_date from clock_in_at (IST). 0 rows today → no-op.
UPDATE public.medic_attendance
  SET work_date = (clock_in_at AT TIME ZONE 'Asia/Kolkata')::date
  WHERE work_date IS NULL;

-- One row per (medic, work_date) — the double-post guard for daily wage.
ALTER TABLE public.medic_attendance
  ADD CONSTRAINT medic_attendance_medic_work_date_unique UNIQUE (medic_id, work_date);

-- =====================================================================
-- 3. Booking earnings (clone of post_doctor_earnings_on_booking + C1 lab guard)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.post_medic_earnings_on_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_medic        public.medics%ROWTYPE;
  v_live         public.medic_ledger_entries%ROWTYPE;
  v_amount       bigint;
  v_entry_date   date;
  v_is_lab       boolean;
BEGIN
  -- Step 1: reverse a live earning for the OLD (booking, medic) pair when the
  -- invariant no longer holds (left COMPLETED, or medic reassigned).
  IF OLD.medic_id IS NOT NULL
     AND OLD.status = 'COMPLETED'
     AND (NEW.status <> 'COMPLETED' OR OLD.medic_id IS DISTINCT FROM NEW.medic_id)
  THEN
    SELECT * INTO v_live
    FROM public.medic_ledger_entries e
    WHERE e.booking_id = NEW.id
      AND e.medic_id   = OLD.medic_id
      AND e.entry_type IN ('revenue_share', 'commission')
      AND NOT EXISTS (SELECT 1 FROM public.medic_ledger_entries r WHERE r.reverses_entry_id = e.id)
    LIMIT 1;
    IF FOUND THEN
      INSERT INTO public.medic_ledger_entries
        (medic_id, entry_type, amount_paise, entry_date, description, booking_id, reverses_entry_id)
      VALUES
        (v_live.medic_id, 'reversal', -v_live.amount_paise, CURRENT_DATE,
         format('Auto-reversal: booking %s left COMPLETED (now %s)', NEW.booking_code, NEW.status),
         NEW.id, v_live.id);
    END IF;
  END IF;

  -- Step 2: post the earning the NEW state should have, if none is live.
  -- C1 — lab bookings produce no medic earning (sample collection is not a
  -- clinical visit for either pay model).
  v_is_lab := lower(coalesce(NEW.service_category, '')) IN ('lab','lab-tests','diagnostics');
  IF NEW.medic_id IS NOT NULL AND NEW.status = 'COMPLETED' AND NOT v_is_lab THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.medic_ledger_entries e
      WHERE e.booking_id = NEW.id
        AND e.medic_id   = NEW.medic_id
        AND e.entry_type IN ('revenue_share', 'commission')
        AND NOT EXISTS (SELECT 1 FROM public.medic_ledger_entries r WHERE r.reverses_entry_id = e.id)
    ) THEN
      SELECT * INTO v_medic FROM public.medics WHERE id = NEW.medic_id;
      IF v_medic.id IS NOT NULL THEN
        v_entry_date := COALESCE(NEW.completed_at::date, CURRENT_DATE);
        IF v_medic.medic_type = 'freelancer' THEN
          v_amount := round(
            COALESCE(v_medic.revenue_share_pct, 0)
            * (COALESCE(NEW.booking_fee_paid_paise, 0) + COALESCE(NEW.balance_paid_paise, 0))
            / 100.0
          )::bigint;
          IF v_amount > 0 THEN
            INSERT INTO public.medic_ledger_entries
              (medic_id, entry_type, amount_paise, entry_date, description, booking_id)
            VALUES
              (NEW.medic_id, 'revenue_share', v_amount, v_entry_date,
               format('Revenue share %s%% on booking %s', v_medic.revenue_share_pct, NEW.booking_code),
               NEW.id);
          END IF;
        ELSIF v_medic.medic_type = 'salaried' THEN
          v_amount := COALESCE(v_medic.commission_per_visit_paise, 0);
          IF v_amount > 0 THEN
            INSERT INTO public.medic_ledger_entries
              (medic_id, entry_type, amount_paise, entry_date, description, booking_id)
            VALUES
              (NEW.medic_id, 'commission', v_amount, v_entry_date,
               format('Per-visit commission on booking %s', NEW.booking_code),
               NEW.id);
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.post_medic_earnings_on_booking() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_bookings_medic_earnings ON public.bookings;
CREATE TRIGGER trg_bookings_medic_earnings
  AFTER UPDATE OF status, medic_id ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.post_medic_earnings_on_booking();

-- =====================================================================
-- 4. Attendance earnings (clone of post_doctor_earnings_on_attendance + selfie gate)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.post_medic_earnings_on_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_medic        public.medics%ROWTYPE;
  v_live         public.medic_ledger_entries%ROWTYPE;
  v_target_wage  bigint := 0;
  v_target_ot    bigint := 0;
BEGIN
  -- Targets: salaried AND present AND SELFIE-VERIFIED AND work_date known.
  -- Bare clock-in (no selfie) sets nothing → no daily_wage posts.
  SELECT * INTO v_medic FROM public.medics WHERE id = NEW.medic_id;
  IF v_medic.id IS NOT NULL
     AND v_medic.medic_type = 'salaried'
     AND NEW.is_present = true
     AND NEW.selfie_verified_at IS NOT NULL
     AND NEW.work_date IS NOT NULL
  THEN
    v_target_wage := COALESCE(v_medic.daily_wage_paise, 0);
    v_target_ot   := COALESCE(NEW.overtime_amount_paise, 0);
  END IF;

  -- --- daily_wage lane ---
  SELECT * INTO v_live
  FROM public.medic_ledger_entries e
  WHERE e.attendance_id = NEW.id
    AND e.entry_type = 'daily_wage'
    AND NOT EXISTS (SELECT 1 FROM public.medic_ledger_entries r WHERE r.reverses_entry_id = e.id)
  LIMIT 1;

  IF FOUND AND v_live.amount_paise <> v_target_wage THEN
    INSERT INTO public.medic_ledger_entries
      (medic_id, entry_type, amount_paise, entry_date, description, attendance_id, reverses_entry_id)
    VALUES
      (v_live.medic_id, 'reversal', -v_live.amount_paise, CURRENT_DATE,
       format('Auto-reversal of daily_wage for %s', NEW.work_date), NEW.id, v_live.id);
    v_live := NULL;
  END IF;

  IF v_live.id IS NULL AND v_target_wage > 0 THEN
    INSERT INTO public.medic_ledger_entries
      (medic_id, entry_type, amount_paise, entry_date, description, attendance_id)
    VALUES
      (NEW.medic_id, 'daily_wage', v_target_wage, NEW.work_date,
       format('Daily wage for %s', NEW.work_date), NEW.id);
  END IF;

  -- --- overtime lane (also selfie-gated via v_target_ot) ---
  v_live := NULL;
  SELECT * INTO v_live
  FROM public.medic_ledger_entries e
  WHERE e.attendance_id = NEW.id
    AND e.entry_type = 'overtime'
    AND NOT EXISTS (SELECT 1 FROM public.medic_ledger_entries r WHERE r.reverses_entry_id = e.id)
  LIMIT 1;

  IF FOUND AND v_live.amount_paise <> v_target_ot THEN
    INSERT INTO public.medic_ledger_entries
      (medic_id, entry_type, amount_paise, entry_date, description, attendance_id, reverses_entry_id)
    VALUES
      (v_live.medic_id, 'reversal', -v_live.amount_paise, CURRENT_DATE,
       format('Auto-reversal of overtime for %s', NEW.work_date), NEW.id, v_live.id);
    v_live := NULL;
  END IF;

  IF v_live.id IS NULL AND v_target_ot > 0 THEN
    INSERT INTO public.medic_ledger_entries
      (medic_id, entry_type, amount_paise, entry_date, description, attendance_id)
    VALUES
      (NEW.medic_id, 'overtime', v_target_ot, NEW.work_date,
       format('Overtime for %s%s', NEW.work_date,
              CASE WHEN NEW.overtime_hours IS NOT NULL THEN ' (' || NEW.overtime_hours || ' hrs)' ELSE '' END),
       NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.post_medic_earnings_on_attendance() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_medic_attendance_earnings ON public.medic_attendance;
CREATE TRIGGER trg_medic_attendance_earnings
  AFTER INSERT OR UPDATE ON public.medic_attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.post_medic_earnings_on_attendance();

COMMENT ON FUNCTION public.post_medic_earnings_on_booking() IS
  'Medic payroll — clone of post_doctor_earnings_on_booking with the C1 lab-service guard. One live earning per (booking, medic) iff COMPLETED + non-lab. SECURITY DEFINER.';
COMMENT ON FUNCTION public.post_medic_earnings_on_attendance() IS
  'Medic payroll — clone of post_doctor_earnings_on_attendance with the selfie gate (daily_wage/overtime post only when selfie_verified_at IS NOT NULL). SECURITY DEFINER.';
