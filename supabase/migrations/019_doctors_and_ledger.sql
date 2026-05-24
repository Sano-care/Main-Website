-- Migration 019 — Doctors master + append-only ledger + auto-posting triggers
--
-- M4 schema (founder-confirmed):
--   * doctors            — per §6.4. Two types: freelancer (% of collected)
--                          and salaried (daily wage + per-visit commission
--                          + optional overtime). Doctor codes are SAN-D-NNNNN
--                          via the existing next_code('doctor') — same 5-digit
--                          padding as every other code series (decision: option
--                          (a), don't vary padding per type).
--   * doctor_attendance  — per §6.4a. One row per (doctor, work_date). Marking
--                          present posts a daily_wage ledger entry via trigger;
--                          flipping is_present back to false posts a reversal.
--                          Overtime on a present day posts an `overtime` entry
--                          (reverse-and-repost on edit). No DELETE path — the
--                          ledger is append-only across the board.
--   * doctor_ledger_entries — per §6.12. Append-only. Every row is either
--                          system-posted (trigger / SECURITY DEFINER) or
--                          manually inserted by an admin (payout, adjustment).
--                          Reversals point at the entry they reverse via
--                          reverses_entry_id.
--   * bookings.doctor_id — nullable FK; any ops user can assign (existing
--                          bookings RLS). Earning posts only when the booking
--                          reaches COMPLETED.
--
-- Auto-posting works regardless of the calling role: triggers are SECURITY
-- DEFINER on the post_*() functions, so an *agent* completing a booking still
-- causes the system to write to doctor_ledger_entries (which agents otherwise
-- have no INSERT privilege on).
--
-- The cms_doctors table from M005 is the CMS marketing block and is NOT
-- touched here. This migration introduces a separate operational
-- public.doctors table.
--
-- Idempotent: safe to re-run on a clean install.

-- =====================================================================
-- 0. PRE-FLIGHT: confirm bookings.status uses the UPPERCASE casing the
--                earning triggers compare against
-- =====================================================================
-- The CHECK constraint on bookings.status from M007 + M008 declares
-- UPPERCASE values ('PENDING', 'COMPLETED', etc.) and every M2+ code
-- site reads/writes UPPERCASE. The trigger below compares
-- status = 'COMPLETED' — if any row in the live table has drifted to
-- lowercase / mixed (manual SQL, restored backup, etc.), that comparison
-- would silently never fire and earnings would never post.
--
-- Abort the migration here with a useful diagnostic instead of installing
-- triggers that look correct but quietly do nothing.

DO $$
DECLARE
  r record;
  v_mismatch_count integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT status
    FROM public.bookings
    WHERE status IS NOT NULL
      AND status <> upper(status)
  LOOP
    RAISE NOTICE 'Non-uppercase bookings.status detected: %', quote_literal(r.status);
    v_mismatch_count := v_mismatch_count + 1;
  END LOOP;
  IF v_mismatch_count > 0 THEN
    RAISE EXCEPTION
      'Migration 019 aborted: bookings.status has % distinct non-uppercase value(s) (see NOTICE rows above). The earning triggers compare status = ''COMPLETED'' (uppercase). Resolve the data drift, OR tell us the actual casing so the trigger comparison can be updated, then re-run.',
      v_mismatch_count;
  END IF;
END $$;

-- =====================================================================
-- 1. doctors
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.doctors (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_code                text UNIQUE NOT NULL,
  full_name                  text NOT NULL,
  qualification              text,
  registration_no            text,
  phone                      text,
  email                      text,
  doctor_type                text NOT NULL
                             CHECK (doctor_type IN ('freelancer', 'salaried')),
  -- Freelancer pay terms
  revenue_share_pct          numeric(5,2)
                             CHECK (revenue_share_pct IS NULL OR (revenue_share_pct >= 0 AND revenue_share_pct <= 100)),
  -- Salaried pay terms
  daily_wage_paise           integer
                             CHECK (daily_wage_paise IS NULL OR daily_wage_paise >= 0),
  commission_per_visit_paise integer
                             CHECK (commission_per_visit_paise IS NULL OR commission_per_visit_paise >= 0),
  overtime_hourly_paise      integer
                             CHECK (overtime_hourly_paise IS NULL OR overtime_hourly_paise >= 0),
  pay_notes                  text,
  is_active                  boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid REFERENCES public.ops_users(id) ON DELETE SET NULL,
  -- Type ↔ required pay-fields integrity. Mirrors what the UI enforces;
  -- duplicated here so direct SQL can't slip past it.
  CONSTRAINT doctors_pay_terms_match_type CHECK (
    (doctor_type = 'freelancer' AND revenue_share_pct IS NOT NULL)
    OR
    (doctor_type = 'salaried'
       AND daily_wage_paise IS NOT NULL
       AND commission_per_visit_paise IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_doctors_active ON public.doctors (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_doctors_type   ON public.doctors (doctor_type);

COMMENT ON TABLE public.doctors IS
  'Operational doctor records — distinct from cms_doctors (M005, marketing). Two pay models: freelancer (revenue_share_pct) and salaried (daily wage + commission + optional overtime). doctor_code is SAN-D-NNNNN via next_code(''doctor''). Deactivate via is_active=false; the ledger FK is ON DELETE RESTRICT so a doctor with any ledger history cannot be deleted at all.';

-- =====================================================================
-- 2. doctor_attendance
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.doctor_attendance (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id              uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  work_date              date NOT NULL,
  is_present             boolean NOT NULL DEFAULT true,
  -- Optional overtime captured on a present day. Hours kept for audit;
  -- amount_paise is what the ledger posts (lets ops enter a flat amount
  -- when there's no per-doctor hourly rate).
  overtime_hours         numeric(5,2)
                         CHECK (overtime_hours IS NULL OR overtime_hours >= 0),
  overtime_amount_paise  integer
                         CHECK (overtime_amount_paise IS NULL OR overtime_amount_paise >= 0),
  note                   text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid REFERENCES public.ops_users(id) ON DELETE SET NULL,
  -- One stamp per (doctor, date). Guards double-posting of the daily wage.
  CONSTRAINT doctor_attendance_doctor_work_date_unique UNIQUE (doctor_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_doctor_attendance_doctor_date
  ON public.doctor_attendance (doctor_id, work_date DESC);

COMMENT ON TABLE public.doctor_attendance IS
  'Salaried-doctor attendance stamps. UNIQUE (doctor_id, work_date) prevents double-posting the daily wage. Undoing a stamp = flip is_present to false (no DELETE — ledger is append-only).';

-- =====================================================================
-- 3. doctor_ledger_entries
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.doctor_ledger_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ON DELETE RESTRICT — the ledger is append-only and irreplaceable.
  -- Without RESTRICT, deleting a doctor (even by service-role) would
  -- silently wipe their entire pay history. With RESTRICT, a delete is
  -- physically blocked at the FK level whenever any ledger rows exist
  -- for that doctor. Combined with the absence of a DELETE policy on
  -- doctors below, this means the only path to "remove" a doctor is
  -- soft-delete via is_active=false.
  doctor_id           uuid NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  entry_type          text NOT NULL
                      CHECK (entry_type IN (
                        'revenue_share',  -- freelancer earning from a completed booking
                        'commission',     -- salaried per-visit earning
                        'daily_wage',     -- salaried per-day earning
                        'overtime',       -- salaried overtime on a present day
                        'payout',         -- ops paid the doctor (negative)
                        'adjustment',     -- manual correction (signed)
                        'reversal'        -- auto-posted negation of a prior entry
                      )),
  -- SIGNED. Earnings positive, payouts/reversals negative. Sum across all
  -- entries for a doctor = current balance ("earnings minus paid out").
  amount_paise        integer NOT NULL,
  -- When the work happened / when the payout was made. Distinct from
  -- created_at, which is when the row landed in the DB.
  entry_date          date NOT NULL,
  description         text,
  -- Source-of-truth pointers. Exactly zero or one of these is set,
  -- depending on the entry origin. reverses_entry_id is set on reversals.
  booking_id          uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  attendance_id       uuid REFERENCES public.doctor_attendance(id) ON DELETE SET NULL,
  reverses_entry_id   uuid REFERENCES public.doctor_ledger_entries(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- NULL for system-posted entries (trigger). Admin-posted payouts and
  -- adjustments carry the ops_user id.
  created_by          uuid REFERENCES public.ops_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_doctor_ledger_doctor_date
  ON public.doctor_ledger_entries (doctor_id, entry_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_doctor_ledger_booking
  ON public.doctor_ledger_entries (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doctor_ledger_attendance
  ON public.doctor_ledger_entries (attendance_id) WHERE attendance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doctor_ledger_reverses
  ON public.doctor_ledger_entries (reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;

COMMENT ON TABLE public.doctor_ledger_entries IS
  'Append-only ledger of doctor earnings, payouts, adjustments, and reversals. SUM(amount_paise) per doctor = running balance. The ledger is never UPDATEd or DELETEd — corrections happen by reverse-and-repost. System-posted entries (revenue_share/commission/daily_wage/overtime/reversal) land via SECURITY DEFINER triggers; admin-posted entries (payout/adjustment) land via RLS-gated INSERTs. doctor_id ON DELETE RESTRICT guarantees the ledger cannot be silently wiped by deleting the doctor row.';

-- =====================================================================
-- 4. bookings.doctor_id
-- =====================================================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS doctor_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_doctor_id
  ON public.bookings (doctor_id) WHERE doctor_id IS NOT NULL;

COMMENT ON COLUMN public.bookings.doctor_id IS
  'Optional FK to doctors. Any ops user (admin or agent) can assign; earning auto-posts to the doctor ledger only when status reaches COMPLETED.';

-- =====================================================================
-- 5. code_counters — seed 'doctor' counter
-- =====================================================================
-- Same 5-digit padding as every other code (option (a) — keeps next_code()
-- contract uniform; doctor codes are SAN-D-00001 onward).
INSERT INTO public.code_counters (code_type, prefix, last_number) VALUES
  ('doctor', 'SAN-D-', 0)
ON CONFLICT (code_type) DO NOTHING;

-- =====================================================================
-- 6. Trigger: post / reverse earnings on booking status & doctor changes
-- =====================================================================
-- Invariant the trigger maintains:
--   For each (booking_id, doctor_id) pair there is at most one "live"
--   earning entry (revenue_share | commission) iff the booking is in
--   status='COMPLETED' AND its doctor_id matches. Anything else → no
--   live entry. The trigger reconciles to that invariant on every
--   status or doctor_id change.
--
-- A "live" entry = an earning entry that has not been reversed (no other
-- entry has reverses_entry_id pointing at it).
--
-- INSERT-time COMPLETED bookings are not handled here — the public
-- booking flow and the ops create-booking flow both insert with PENDING
-- / PENDING_COLLECTION; status moves to COMPLETED only via UPDATE.
--
-- The pre-flight check at step 0 confirms 'COMPLETED' is the right
-- casing to compare against in the live table.

CREATE OR REPLACE FUNCTION public.post_doctor_earnings_on_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_doctor       public.doctors%ROWTYPE;
  v_live         public.doctor_ledger_entries%ROWTYPE;
  v_amount       integer;
  v_entry_date   date;
BEGIN
  -- ===== Step 1: reverse any live earning for the OLD (booking, doctor)
  --                pair if the invariant no longer holds. =====
  IF OLD.doctor_id IS NOT NULL
     AND OLD.status = 'COMPLETED'
     AND (NEW.status <> 'COMPLETED' OR OLD.doctor_id IS DISTINCT FROM NEW.doctor_id)
  THEN
    SELECT * INTO v_live
    FROM public.doctor_ledger_entries e
    WHERE e.booking_id = NEW.id
      AND e.doctor_id  = OLD.doctor_id
      AND e.entry_type IN ('revenue_share', 'commission')
      AND NOT EXISTS (
        SELECT 1 FROM public.doctor_ledger_entries r
        WHERE r.reverses_entry_id = e.id
      )
    LIMIT 1;
    IF FOUND THEN
      INSERT INTO public.doctor_ledger_entries
        (doctor_id, entry_type, amount_paise, entry_date, description, booking_id, reverses_entry_id)
      VALUES
        (v_live.doctor_id, 'reversal',
         -v_live.amount_paise,
         CURRENT_DATE,
         format('Auto-reversal: booking %s left COMPLETED (now %s)', NEW.booking_code, NEW.status),
         NEW.id, v_live.id);
    END IF;
  END IF;

  -- ===== Step 2: post the earning the NEW state should have, if none
  --                is already live for (booking, NEW.doctor_id). =====
  IF NEW.doctor_id IS NOT NULL AND NEW.status = 'COMPLETED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.doctor_ledger_entries e
      WHERE e.booking_id = NEW.id
        AND e.doctor_id  = NEW.doctor_id
        AND e.entry_type IN ('revenue_share', 'commission')
        AND NOT EXISTS (
          SELECT 1 FROM public.doctor_ledger_entries r
          WHERE r.reverses_entry_id = e.id
        )
    ) THEN
      SELECT * INTO v_doctor FROM public.doctors WHERE id = NEW.doctor_id;
      IF v_doctor.id IS NOT NULL THEN
        v_entry_date := COALESCE(NEW.completed_at::date, CURRENT_DATE);
        IF v_doctor.doctor_type = 'freelancer' THEN
          -- revenue_share_pct (e.g. 40.00) × collected (booking_fee + balance),
          -- rounded to whole paise. Lab-report payment lane is intentionally
          -- excluded — that's the patient paying for tests, not visit revenue.
          v_amount := round(
            COALESCE(v_doctor.revenue_share_pct, 0)
            * (COALESCE(NEW.booking_fee_paid_paise, 0) + COALESCE(NEW.balance_paid_paise, 0))
            / 100.0
          )::integer;
          IF v_amount > 0 THEN
            INSERT INTO public.doctor_ledger_entries
              (doctor_id, entry_type, amount_paise, entry_date, description, booking_id)
            VALUES
              (NEW.doctor_id, 'revenue_share', v_amount, v_entry_date,
               format('Revenue share %s%% on booking %s', v_doctor.revenue_share_pct, NEW.booking_code),
               NEW.id);
          END IF;
        ELSIF v_doctor.doctor_type = 'salaried' THEN
          v_amount := COALESCE(v_doctor.commission_per_visit_paise, 0);
          IF v_amount > 0 THEN
            INSERT INTO public.doctor_ledger_entries
              (doctor_id, entry_type, amount_paise, entry_date, description, booking_id)
            VALUES
              (NEW.doctor_id, 'commission', v_amount, v_entry_date,
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

REVOKE ALL ON FUNCTION public.post_doctor_earnings_on_booking() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_bookings_doctor_earnings ON public.bookings;
CREATE TRIGGER trg_bookings_doctor_earnings
  AFTER UPDATE OF status, doctor_id ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.post_doctor_earnings_on_booking();

COMMENT ON FUNCTION public.post_doctor_earnings_on_booking() IS
  'BEFORE/AFTER trigger fn on bookings. Reconciles doctor_ledger_entries against the rule: one live earning per (booking, doctor) iff booking is COMPLETED with that doctor assigned. Idempotent — re-firing on no-op changes posts nothing. SECURITY DEFINER so agents (no direct INSERT on doctor_ledger_entries) can still drive the auto-post by changing bookings.status.';

-- =====================================================================
-- 7. Trigger: post / reverse daily_wage + overtime on attendance changes
-- =====================================================================
-- Invariant: for each attendance row, the ledger holds exactly the live
-- entries the row's current state requires:
--    daily_wage entry  iff is_present = true AND doctor is salaried AND
--                          doctor.daily_wage_paise > 0
--    overtime entry    iff is_present = true AND
--                          overtime_amount_paise > 0
-- On any change, reverse mismatched live entries + post any that should
-- exist but don't (with the right amount).

CREATE OR REPLACE FUNCTION public.post_doctor_earnings_on_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_doctor       public.doctors%ROWTYPE;
  v_live         public.doctor_ledger_entries%ROWTYPE;
  v_target_wage  integer := 0;
  v_target_ot    integer := 0;
BEGIN
  -- Compute the target amounts for each lane.
  SELECT * INTO v_doctor FROM public.doctors WHERE id = NEW.doctor_id;
  IF v_doctor.id IS NOT NULL
     AND v_doctor.doctor_type = 'salaried'
     AND NEW.is_present = true
  THEN
    v_target_wage := COALESCE(v_doctor.daily_wage_paise, 0);
    v_target_ot   := COALESCE(NEW.overtime_amount_paise, 0);
  END IF;

  -- --- daily_wage lane ---
  SELECT * INTO v_live
  FROM public.doctor_ledger_entries e
  WHERE e.attendance_id = NEW.id
    AND e.entry_type = 'daily_wage'
    AND NOT EXISTS (
      SELECT 1 FROM public.doctor_ledger_entries r
      WHERE r.reverses_entry_id = e.id
    )
  LIMIT 1;

  IF FOUND AND v_live.amount_paise <> v_target_wage THEN
    -- Live entry exists but amount no longer matches target → reverse it.
    INSERT INTO public.doctor_ledger_entries
      (doctor_id, entry_type, amount_paise, entry_date, description, attendance_id, reverses_entry_id)
    VALUES
      (v_live.doctor_id, 'reversal', -v_live.amount_paise, CURRENT_DATE,
       format('Auto-reversal of daily_wage for %s', NEW.work_date),
       NEW.id, v_live.id);
    v_live := NULL;
  END IF;

  IF v_live.id IS NULL AND v_target_wage > 0 THEN
    -- No live entry but target says there should be one → post.
    INSERT INTO public.doctor_ledger_entries
      (doctor_id, entry_type, amount_paise, entry_date, description, attendance_id)
    VALUES
      (NEW.doctor_id, 'daily_wage', v_target_wage, NEW.work_date,
       format('Daily wage for %s', NEW.work_date), NEW.id);
  END IF;

  -- --- overtime lane ---
  v_live := NULL;
  SELECT * INTO v_live
  FROM public.doctor_ledger_entries e
  WHERE e.attendance_id = NEW.id
    AND e.entry_type = 'overtime'
    AND NOT EXISTS (
      SELECT 1 FROM public.doctor_ledger_entries r
      WHERE r.reverses_entry_id = e.id
    )
  LIMIT 1;

  IF FOUND AND v_live.amount_paise <> v_target_ot THEN
    INSERT INTO public.doctor_ledger_entries
      (doctor_id, entry_type, amount_paise, entry_date, description, attendance_id, reverses_entry_id)
    VALUES
      (v_live.doctor_id, 'reversal', -v_live.amount_paise, CURRENT_DATE,
       format('Auto-reversal of overtime for %s', NEW.work_date),
       NEW.id, v_live.id);
    v_live := NULL;
  END IF;

  IF v_live.id IS NULL AND v_target_ot > 0 THEN
    INSERT INTO public.doctor_ledger_entries
      (doctor_id, entry_type, amount_paise, entry_date, description, attendance_id)
    VALUES
      (NEW.doctor_id, 'overtime', v_target_ot, NEW.work_date,
       format('Overtime for %s%s', NEW.work_date,
              CASE WHEN NEW.overtime_hours IS NOT NULL
                   THEN ' (' || NEW.overtime_hours || ' hrs)'
                   ELSE '' END),
       NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.post_doctor_earnings_on_attendance() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_doctor_attendance_earnings ON public.doctor_attendance;
CREATE TRIGGER trg_doctor_attendance_earnings
  AFTER INSERT OR UPDATE ON public.doctor_attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.post_doctor_earnings_on_attendance();

COMMENT ON FUNCTION public.post_doctor_earnings_on_attendance() IS
  'AFTER INSERT/UPDATE trigger fn on doctor_attendance. Reconciles each lane (daily_wage / overtime) against the row''s current state: posts when missing, reverses when target = 0 or amount changed. SECURITY DEFINER so the admin marking attendance drives an INSERT into doctor_ledger_entries regardless of RLS.';

-- =====================================================================
-- 8. RLS
-- =====================================================================
ALTER TABLE public.doctors               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_attendance     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_ledger_entries ENABLE ROW LEVEL SECURITY;

-- ---- doctors ----
DROP POLICY IF EXISTS "doctors readable by ops" ON public.doctors;
CREATE POLICY "doctors readable by ops"
  ON public.doctors FOR SELECT TO authenticated
  USING (public.is_ops_user());

DROP POLICY IF EXISTS "doctors insertable by ops admins" ON public.doctors;
CREATE POLICY "doctors insertable by ops admins"
  ON public.doctors FOR INSERT TO authenticated
  WITH CHECK (public.is_ops_admin());

DROP POLICY IF EXISTS "doctors updatable by ops admins" ON public.doctors;
CREATE POLICY "doctors updatable by ops admins"
  ON public.doctors FOR UPDATE TO authenticated
  USING (public.is_ops_admin()) WITH CHECK (public.is_ops_admin());

-- NO DELETE POLICY on doctors. The intended way to "remove" a doctor is
-- soft-delete via is_active = false. Even with the policy absent,
-- defence in depth: doctor_ledger_entries.doctor_id is ON DELETE RESTRICT
-- (above), so a service-role delete also fails if any ledger history
-- exists for the doctor.
-- Explicit DROP for re-runs that previously installed the policy.
DROP POLICY IF EXISTS "doctors deletable by ops admins" ON public.doctors;

-- ---- doctor_attendance ----
DROP POLICY IF EXISTS "doctor_attendance readable by ops" ON public.doctor_attendance;
CREATE POLICY "doctor_attendance readable by ops"
  ON public.doctor_attendance FOR SELECT TO authenticated
  USING (public.is_ops_user());

DROP POLICY IF EXISTS "doctor_attendance insertable by ops admins" ON public.doctor_attendance;
CREATE POLICY "doctor_attendance insertable by ops admins"
  ON public.doctor_attendance FOR INSERT TO authenticated
  WITH CHECK (public.is_ops_admin());

DROP POLICY IF EXISTS "doctor_attendance updatable by ops admins" ON public.doctor_attendance;
CREATE POLICY "doctor_attendance updatable by ops admins"
  ON public.doctor_attendance FOR UPDATE TO authenticated
  USING (public.is_ops_admin()) WITH CHECK (public.is_ops_admin());

-- No DELETE policy: ledger model is append-only end-to-end. To "undo"
-- attendance, flip is_present to false via UPDATE — the trigger reverses
-- the wage + overtime entries.

-- ---- doctor_ledger_entries ----
DROP POLICY IF EXISTS "doctor_ledger readable by ops" ON public.doctor_ledger_entries;
CREATE POLICY "doctor_ledger readable by ops"
  ON public.doctor_ledger_entries FOR SELECT TO authenticated
  USING (public.is_ops_user());

-- Admins can INSERT payout / adjustment rows directly from the UI. Every
-- other entry type is system-posted via the SECURITY DEFINER triggers
-- (which bypass RLS), so this policy doesn't need to cover them — but it
-- doesn't restrict by entry_type, so an admin can also post any kind
-- manually if they really need to.
DROP POLICY IF EXISTS "doctor_ledger insertable by ops admins" ON public.doctor_ledger_entries;
CREATE POLICY "doctor_ledger insertable by ops admins"
  ON public.doctor_ledger_entries FOR INSERT TO authenticated
  WITH CHECK (public.is_ops_admin());

-- No UPDATE or DELETE policies: append-only.

-- =====================================================================
-- 9. Sanity summary (visible in the Messages panel)
-- =====================================================================
DO $$
DECLARE
  v_doctor_seeded boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.code_counters WHERE code_type = 'doctor')
    INTO v_doctor_seeded;
  RAISE NOTICE 'Migration 019: doctors/doctor_attendance/doctor_ledger_entries created. bookings.doctor_id added. code_counters ''doctor'' seeded: %. No doctors DELETE policy (soft-delete via is_active). Ledger FK ON DELETE RESTRICT.', v_doctor_seeded;
END $$;
