-- =============================================================================
-- M040 (T85 PR4b v2) — extend `bookings.report_payment_status` CHECK to accept
-- the new `'PARTIAL_PAID'` value used by lab booking Mode B (₹200 prepaid +
-- balance at door via UPI).
--
-- Strategy: keep all existing values (NOT_DUE, LINK_SENT, CAPTURED, REFUNDED)
-- so legacy rows from M008's lifecycle stay valid. Add PARTIAL_PAID for the
-- new state. No migration of existing data; new lab Mode B writes use the
-- new value going forward, legacy rows keep their existing values until they
-- clear naturally.
--
-- ⚠️ NOTE — original founder M040 sketch missed REFUNDED. Verified live
-- CHECK via `pg_get_constraintdef` 2026-06-08; REFUNDED is in the
-- production constraint and would have been dropped if we'd applied the
-- sketch verbatim. Preserving it here.
-- =============================================================================

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_report_payment_status_check;

ALTER TABLE bookings ADD CONSTRAINT bookings_report_payment_status_check
  CHECK (report_payment_status IS NULL OR report_payment_status IN (
    -- Legacy lifecycle (M008/M009) — kept for back-compat with the
    -- magic-link-paywall path that 19 prod lab rows are still walking.
    'NOT_DUE', 'LINK_SENT', 'CAPTURED', 'REFUNDED',
    -- T85 PR4b Mode B (M040) — partial-paid state. Booking row paid
    -- ₹200 collection fee at booking; balance owed at collection door
    -- via UPI. Ops surfaces query for this status to flag bookings
    -- needing doorstep collection.
    'PARTIAL_PAID'
  ));

COMMENT ON CONSTRAINT bookings_report_payment_status_check ON bookings IS
  'M040 extension: PARTIAL_PAID added for PR4b lab partial-payment mode (₹200 prepaid, balance UPI at door). Legacy values preserved for back-compat.';
