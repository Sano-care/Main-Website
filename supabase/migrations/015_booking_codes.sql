-- Migration 015 — Booking codes (SAN-B-NNNNN) + ops INSERT policy
--
-- Adds a human-readable, unique booking_code (e.g. SAN-B-00007) so ops
-- and patients can refer to a booking without copying a UUID. A BEFORE
-- INSERT trigger assigns the code automatically on every insert path:
--
--   * Public booking-flow API routes (service-role)
--   * /ops/bookings/new (authenticated ops)
--   * Anything future, including direct SQL
--
-- Also adds an INSERT policy on bookings so the new /ops/bookings/new
-- page can create bookings using the cookie-authed RLS client.
-- M2 deliberately left INSERT/DELETE policies off; we add INSERT now
-- because the ops UI needs it. Service-role still bypasses RLS, so the
-- public booking flow + Razorpay webhook are unaffected.
--
-- Idempotent: safe to re-run.

-- =====================================================================
-- booking_code column + index
-- =====================================================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS booking_code text UNIQUE;

CREATE INDEX IF NOT EXISTS idx_bookings_booking_code
  ON public.bookings (booking_code);

COMMENT ON COLUMN public.bookings.booking_code IS
  'Human-readable booking reference (SAN-B-00001). Allocated by the trg_bookings_assign_code trigger on INSERT via public.next_code(''booking''). UNIQUE; NULL only for rows older than migration 015 if the backfill is interrupted.';

-- =====================================================================
-- Seed the counter
-- =====================================================================
INSERT INTO public.code_counters (code_type, prefix, last_number) VALUES
  ('booking', 'SAN-B-', 0)
ON CONFLICT (code_type) DO NOTHING;

-- =====================================================================
-- Trigger function + trigger
-- =====================================================================
-- SECURITY DEFINER so the trigger works regardless of which role is
-- doing the INSERT (service-role bypasses RLS but still needs the
-- counter write; authenticated ops users go through the trigger too).
-- next_code() is itself SECURITY DEFINER so the chain is fine.
CREATE OR REPLACE FUNCTION public.assign_booking_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.booking_code IS NULL THEN
    NEW.booking_code := public.next_code('booking');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_booking_code() FROM PUBLIC;

COMMENT ON FUNCTION public.assign_booking_code() IS
  'BEFORE INSERT trigger function: stamps NEW.booking_code via public.next_code(''booking'') when not already set. Safe to call on every insert path because next_code is atomic.';

DROP TRIGGER IF EXISTS trg_bookings_assign_code ON public.bookings;
CREATE TRIGGER trg_bookings_assign_code
  BEFORE INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_booking_code();

-- =====================================================================
-- INSERT policy for ops users
-- =====================================================================
-- M2 added SELECT + UPDATE policies but deliberately omitted INSERT
-- because there was no UI for ops-created bookings. M2.6 introduces
-- /ops/bookings/new, which inserts via the cookie-authed client, so we
-- need a permissive policy now.
DROP POLICY IF EXISTS "bookings insertable by ops" ON public.bookings;
CREATE POLICY "bookings insertable by ops"
  ON public.bookings FOR INSERT TO authenticated
  WITH CHECK (public.is_ops_user());

-- =====================================================================
-- Backfill — chronological order so codes match booking timeline
-- =====================================================================
-- Row-by-row loop (not a single UPDATE) so that next_code() is called
-- in created_at order; a set-based UPDATE wouldn't guarantee order and
-- the codes would not correspond to the booking timeline.
DO $$
DECLARE
  v_id    uuid;
  v_count integer := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM public.bookings
    WHERE booking_code IS NULL
    ORDER BY created_at ASC, id ASC
  LOOP
    UPDATE public.bookings
       SET booking_code = public.next_code('booking')
     WHERE id = v_id;
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Migration 015 backfill: assigned booking_code to % bookings', v_count;
END $$;
