-- Migration 009 — Lab test discount coupons
--
-- Adds a coupons table with simple percentage discounts, optional minimum
-- basket size, optional usage caps, and date windows. Plus discount columns
-- on the bookings table so each lab booking remembers which coupon was
-- applied at the time of booking (in case rates change later).
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.lab_coupons (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text UNIQUE NOT NULL,
  -- For v1 we only support 'percent'. Future: 'flat', 'free_test_addon'.
  discount_type   text NOT NULL DEFAULT 'percent'
                  CHECK (discount_type IN ('percent', 'flat')),
  -- For 'percent', value is the percent off (e.g. 15 = 15%).
  -- For 'flat', value is the rupee amount off (e.g. 200 = ₹200).
  discount_value  numeric(10,2) NOT NULL CHECK (discount_value > 0),
  -- Minimum basket subtotal (in rupees, pre-discount) required to use this code.
  min_basket_inr  integer NOT NULL DEFAULT 0,
  -- Optional cap (in rupees) — coupon never gives more than this amount off.
  max_discount_inr integer,
  -- Total usage cap. NULL = unlimited.
  max_uses        integer,
  -- Running counter incremented by /api/lab/validate-coupon on accept.
  used_count      integer NOT NULL DEFAULT 0,
  -- Optional date window. NULL endpoints = open-ended.
  valid_from      timestamptz,
  valid_to        timestamptz,
  -- Free-text description shown in admin / receipts.
  description     text,
  -- Active flag — flip to false to instantly disable without deleting history.
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lab_coupons_code_active
  ON public.lab_coupons (code) WHERE is_active = true;

COMMENT ON TABLE public.lab_coupons IS
  'Discount coupons for lab-test baskets. Validated server-side via /api/lab/validate-coupon. Discount applied to the Razorpay order at /api/lab/send-report-payment-link.';

-- Discount columns on bookings, remembered per booking row
ALTER TABLE IF EXISTS public.bookings
  ADD COLUMN IF NOT EXISTS applied_coupon_code     text,
  ADD COLUMN IF NOT EXISTS coupon_discount_percent numeric(5,2),
  ADD COLUMN IF NOT EXISTS coupon_discount_paise   integer,
  -- Final amount the patient will actually be charged via the magic link.
  -- = test_total_paise - coupon_discount_paise (server-computed, clamped to >= 0)
  ADD COLUMN IF NOT EXISTS final_amount_paise      integer;

COMMENT ON COLUMN public.bookings.applied_coupon_code IS
  'Coupon code applied at booking time. Stored verbatim even if the coupon is later disabled.';
COMMENT ON COLUMN public.bookings.coupon_discount_paise IS
  'Discount in paise, locked at booking time. Used when /api/lab/send-report-payment-link mints the Razorpay order.';

-- ===== Seed: 3 launch coupons (percentage-only per the CP7 spec) =====
INSERT INTO public.lab_coupons
  (code, discount_type, discount_value, min_basket_inr, max_discount_inr, max_uses, valid_from, valid_to, description)
VALUES
  (
    'LAUNCH10', 'percent', 10, 0, NULL, 200,
    now(), now() + interval '60 days',
    'Launch offer: 10% off any lab basket, valid 60 days. First 200 redemptions.'
  ),
  (
    'FAMILY15', 'percent', 15, 1500, NULL, 100,
    now(), now() + interval '90 days',
    '15% off lab baskets above ₹1,500. Designed for full family check-ups.'
  ),
  (
    'DELHI20', 'percent', 20, 0, 800, 50,
    now(), now() + interval '30 days',
    '20% off (max ₹800) — Delhi launch offer, first 50 redemptions, valid 30 days.'
  )
ON CONFLICT (code) DO NOTHING;
