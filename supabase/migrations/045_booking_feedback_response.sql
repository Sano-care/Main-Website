-- M045 — Slice 2a: patient visit-feedback storage.
--
-- `aarogya_visit_complete` (sent when ops marks a booking COMPLETED)
-- carries 3 Quick-Reply buttons. When the patient taps one, Meta delivers
-- the button label back as an inbound message ("Extremely Satisfied" /
-- "Satisfied" / "Service needs improvement"). This column is where that
-- reply lands.
--
-- NOTE: nothing writes to this column yet. Capturing inbound replies on
-- the Rampwin BSP number requires a Rampwin inbound webhook, which does
-- NOT exist in the codebase as of Slice 2a. This column is forward-prep
-- so wiring that webhook (post-Day-7) is a one-line UPDATE. Additive +
-- nullable — no backfill, no RLS change (bookings policies already cover
-- it; service-role writes bypass RLS).

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS feedback_response text;

COMMENT ON COLUMN public.bookings.feedback_response IS
  'Slice 2a — patient satisfaction Quick-Reply from aarogya_visit_complete. Populated once a Rampwin inbound webhook is wired (not yet built).';
