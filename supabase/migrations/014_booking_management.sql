-- Migration 014 — Ops booking management columns + RLS
--
-- Adds the columns the /ops booking-management UI needs (scheduling +
-- workflow timestamps + ops-only notes + partner link), and locks down
-- the bookings table with RLS so only ops users can read/update through
-- the browser. All public booking flows are server-side and use the
-- service-role key, which bypasses RLS, so they keep working.
--
-- DOES NOT touch the existing status CHECK constraint — the live booking
-- flow and the /ops/lab dashboard depend on it. The ops UI transitions
-- bookings through these existing values:
--
--   Homecare / nursing / teleconsult lifecycle:
--     PENDING → CONFIRMED → DISPATCHED → IN_PROGRESS → COMPLETED
--   Lab home-collection lifecycle:
--     PENDING_COLLECTION → COLLECTED → AT_LAB → REPORT_READY
--                       → AWAITING_PAYMENT → REPORT_DELIVERED
--   Cancellation (any lifecycle): CANCELLED
--
-- Doctor assignment is deferred to M4. No doctor_id added here.
--
-- Idempotent: safe to re-run.

-- =====================================================================
-- New columns on bookings
-- =====================================================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS scheduled_for       timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_at         timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at        timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS ops_notes           text,
  ADD COLUMN IF NOT EXISTS partner_id          uuid REFERENCES public.partners(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.bookings.scheduled_for IS
  'Patient-facing appointment time set by ops. Distinct from created_at (when the booking was placed) and dispatched_at (when a paramedic was sent).';
COMMENT ON COLUMN public.bookings.assigned_at IS
  'First time ops moved the booking out of a pending state (e.g., into DISPATCHED). Stamped once and not overwritten.';
COMMENT ON COLUMN public.bookings.completed_at IS
  'Stamped when status reaches COMPLETED (homecare flow) or REPORT_DELIVERED (lab flow).';
COMMENT ON COLUMN public.bookings.cancelled_at IS
  'Stamped when status changes to CANCELLED via the ops UI.';
COMMENT ON COLUMN public.bookings.cancellation_reason IS
  'Free-text reason captured when ops cancels a booking.';
COMMENT ON COLUMN public.bookings.ops_notes IS
  'Internal ops-only notes. Distinct from the existing patient-facing `notes` column, which is never overwritten by the ops UI.';
COMMENT ON COLUMN public.bookings.partner_id IS
  'Optional referral source (society/clinic/corporate/individual). Linked from /ops/bookings/[id].';

-- =====================================================================
-- Indexes
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_bookings_partner_id ON public.bookings (partner_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status     ON public.bookings (status);

-- =====================================================================
-- RLS
-- =====================================================================
-- Decision (see migration header):
--   * Public booking-flow APIs all use the service-role key (verified by
--     grep across the repo) → bypass RLS, unaffected by anything here.
--   * The only browser-side anon-client access to bookings is the
--     authenticated ops dashboard (legacy /ops/dashboard + the new
--     /ops/bookings* surface). Both run behind the middleware, so the
--     calling user is always an active ops_users row.
--   * Therefore: enabling RLS with policies gated by public.is_ops_user()
--     preserves every working flow AND closes the door on future code
--     accidentally reading bookings with the anon key.

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bookings readable by ops" ON public.bookings;
CREATE POLICY "bookings readable by ops"
  ON public.bookings FOR SELECT TO authenticated
  USING (public.is_ops_user());

DROP POLICY IF EXISTS "bookings updatable by ops" ON public.bookings;
CREATE POLICY "bookings updatable by ops"
  ON public.bookings FOR UPDATE TO authenticated
  USING (public.is_ops_user())
  WITH CHECK (public.is_ops_user());

-- No INSERT or DELETE policies: bookings are created exclusively by the
-- public booking-flow API routes (service-role, bypasses RLS). Deletes
-- are not part of the ops workflow — cancellation is a status change.
