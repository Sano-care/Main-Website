-- Migration 008 — Lab diagnostics flow on bookings
--
-- Extends the bookings table to support the lab-test home-collection flow:
--   * which specific test(s) the patient selected
--   * lab partner reference (single partner = Pathcore for now)
--   * the lifecycle of the lab report (uploaded → payment requested → paid → unlocked)
--   * a one-time magic-link token the patient uses to view their report
--
-- Idempotent: safe to re-run.

ALTER TABLE IF EXISTS public.bookings
  -- Selected tests as JSONB array: [{code, name, price, sample, tat, ...}]
  ADD COLUMN IF NOT EXISTS selected_tests            jsonb,
  -- Sum of selected_tests[].price at booking time, locked in case the catalog moves
  ADD COLUMN IF NOT EXISTS test_total_paise          integer,
  -- Partner lab handling this order. Single partner for now ('pathcore').
  ADD COLUMN IF NOT EXISTS lab_partner               text DEFAULT 'pathcore',
  -- Partner lab's own order/batch number, captured by ops when they log the order with the lab
  ADD COLUMN IF NOT EXISTS lab_partner_order_id      text,
  -- URL of the uploaded report PDF in Supabase Storage (private bucket 'lab-reports')
  ADD COLUMN IF NOT EXISTS report_url                text,
  ADD COLUMN IF NOT EXISTS report_uploaded_at        timestamptz,
  -- One-time magic-link token (URL-safe random hex, 32 chars). Used by /reports/[token]
  ADD COLUMN IF NOT EXISTS report_unlock_token       text UNIQUE,
  -- Lifecycle of the test payment, distinct from the booking-fee payment_status
  ADD COLUMN IF NOT EXISTS report_payment_status     text
    CHECK (
      report_payment_status IS NULL
      OR report_payment_status IN ('NOT_DUE', 'LINK_SENT', 'CAPTURED', 'REFUNDED')
    ),
  -- Razorpay order id for the test-total payment (separate from booking-fee order)
  ADD COLUMN IF NOT EXISTS report_razorpay_order_id  text,
  ADD COLUMN IF NOT EXISTS report_razorpay_payment_id text,
  ADD COLUMN IF NOT EXISTS report_payment_link_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS report_paid_at            timestamptz;

-- Allow new lab-specific booking statuses, plus keep existing values working
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
    CHECK (status IN (
      -- Standard home-visit / nursing / teleconsult lifecycle
      'PENDING', 'CONFIRMED', 'DISPATCHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED',
      -- Lab home-collection lifecycle
      'PENDING_COLLECTION',
      'COLLECTED',
      'AT_LAB',
      'REPORT_READY',
      'AWAITING_PAYMENT',
      'REPORT_DELIVERED'
    ));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not adjust status CHECK constraint; please review manually.';
END $$;

-- Indexes for fast ops-dashboard queries and token lookups
CREATE INDEX IF NOT EXISTS idx_bookings_service_category
  ON public.bookings (service_category) WHERE service_category = 'diagnostics';

CREATE INDEX IF NOT EXISTS idx_bookings_report_unlock_token
  ON public.bookings (report_unlock_token) WHERE report_unlock_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_status_lab
  ON public.bookings (status, lab_partner) WHERE service_category = 'diagnostics';

COMMENT ON COLUMN public.bookings.selected_tests IS
  'JSONB array of selected lab tests at the time of booking. Each item: {code, name, price, sample, tat, method, category}.';
COMMENT ON COLUMN public.bookings.report_unlock_token IS
  'URL-safe random token (32 hex chars) used in /reports/[token] magic link. Generated when ops marks the report ready.';
COMMENT ON COLUMN public.bookings.report_payment_status IS
  'Lifecycle of the test-cost payment. NULL until lab booking. NOT_DUE before report ready. LINK_SENT after payment link generated. CAPTURED after patient pays. REFUNDED if sample rejected.';

-- Storage bucket for report PDFs (separate from app images). Run once in Supabase dashboard
-- if this fails (it will if the bucket already exists or if your role lacks rights):
--
--   insert into storage.buckets (id, name, public)
--   values ('lab-reports', 'lab-reports', false)
--   on conflict (id) do nothing;
--
-- Bucket policy: private. Reports are served via signed URLs minted by the
-- /api/lab/get-report-url endpoint after verifying the unlock token + payment.
