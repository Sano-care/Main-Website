-- Migration 007 — Razorpay payment fields on bookings
--
-- Adds the columns we need to persist Razorpay payment data alongside
-- every confirmed booking. Run this in your Supabase SQL editor.
--
-- Idempotent: safe to re-run.

-- Add payment columns to bookings
ALTER TABLE IF EXISTS public.bookings
  ADD COLUMN IF NOT EXISTS razorpay_order_id        text,
  ADD COLUMN IF NOT EXISTS razorpay_payment_id      text,
  ADD COLUMN IF NOT EXISTS razorpay_signature       text,
  ADD COLUMN IF NOT EXISTS payment_status           text
    CHECK (payment_status IN ('CREATED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIAL_REFUND')),
  ADD COLUMN IF NOT EXISTS booking_fee_paid_paise   integer,
  ADD COLUMN IF NOT EXISTS balance_paid_paise       integer,
  ADD COLUMN IF NOT EXISTS payment_captured_at      timestamptz,
  ADD COLUMN IF NOT EXISTS refund_id                text,
  ADD COLUMN IF NOT EXISTS refunded_at              timestamptz,
  ADD COLUMN IF NOT EXISTS refund_amount_paise      integer;

-- Index the order id for fast lookups (signatures, webhook reconciliation)
CREATE INDEX IF NOT EXISTS idx_bookings_razorpay_order_id
  ON public.bookings (razorpay_order_id);

CREATE INDEX IF NOT EXISTS idx_bookings_payment_status
  ON public.bookings (payment_status);

-- Allow the 'CONFIRMED' status, in addition to whatever PENDING / DISPATCHED /
-- IN_PROGRESS / COMPLETED / CANCELLED you already have. If your status
-- column already has a CHECK constraint, you may need to drop and re-add it
-- to include 'CONFIRMED'. The block below attempts it; ignore the warning
-- if the constraint doesn't exist on your schema yet.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   information_schema.check_constraints
    WHERE  constraint_name = 'bookings_status_check'
  ) THEN
    ALTER TABLE public.bookings DROP CONSTRAINT bookings_status_check;
  END IF;

  ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_status_check
    CHECK (status IN ('PENDING', 'CONFIRMED', 'DISPATCHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not adjust status CHECK constraint; please review manually.';
END $$;

COMMENT ON COLUMN public.bookings.razorpay_order_id IS
  'Razorpay order id returned by orders.create(). One per booking.';
COMMENT ON COLUMN public.bookings.razorpay_payment_id IS
  'Razorpay payment id returned by Checkout on successful payment.';
COMMENT ON COLUMN public.bookings.razorpay_signature IS
  'HMAC-SHA256 signature verifying the order|payment pair. Stored for audit.';
COMMENT ON COLUMN public.bookings.payment_status IS
  'Lifecycle of the payment. CAPTURED = booking-fee debited; REFUNDED = before-dispatch cancellation.';
COMMENT ON COLUMN public.bookings.booking_fee_paid_paise IS
  'Initial payment in paise (24900 = ₹249 default, 49900 = ₹499 full upfront).';
COMMENT ON COLUMN public.bookings.balance_paid_paise IS
  'Balance auto-charged at case close, in paise (25000 = ₹250 default).';
