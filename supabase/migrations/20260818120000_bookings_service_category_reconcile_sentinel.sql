-- P1 defense-in-depth — allow 'unknown' as a service_category reconciliation
-- sentinel so the Razorpay orphan reconciler (reconcileRazorpayOrphans /
-- ensureBookingForCapturedOrder) can ALWAYS record a captured-but-unbooked
-- payment, even for a flow whose order notes carry no recognisable service.
--
-- Known flows resolve a real category in code (FLOW_TO_SERVICE + t85_slug), so
-- 'unknown' is only ever written for a genuinely unrecognised future flow. This
-- keeps the reconciler from erroring (CHECK violation) and silently dropping an
-- orphan — a stub with service='unknown' + a loud ops alert is the correct,
-- honest outcome for ops to reconcile. Real bookings never write 'unknown'.
--
-- Preserves every previously-allowed value; adds only 'unknown'.

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_service_category_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_service_category_check
  CHECK (
    service_category IS NULL OR service_category = ANY (ARRAY[
      'homecare', 'teleconsult', 'chronic', 'diagnostics', 'nursing', 'lab',
      'Home visit', 'home-visit', 'teleconsultation', 'lab-tests',
      'medic-at-home',
      'unknown'
    ])
  );
