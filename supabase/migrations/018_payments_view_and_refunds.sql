-- Migration 018 — Payments view + refunds table + is_ops_admin helper
--
-- Shape per the M3 decisions:
--   * No `payments` table — that's deferred to the Pulse build. Instead a
--     `payments_v` view with security_invoker=true emits one row per
--     payment lane (booking_fee, report_fee) over bookings; bookings RLS
--     therefore applies transitively.
--   * Real `refunds` table — the biggest semantic gap (bookings.refund_id
--     could only hold ONE refund per booking, so partial-refund history
--     was lost). New rows are upserted by razorpay_refund_id by both the
--     ops admin action and the webhook handler (which now creates the row
--     when a refund originates outside the app, e.g. dashboard-issued).
--   * is_ops_admin() helper — mirrors is_ops_user() but adds role='admin'.
--   * UNIQUE on bookings.razorpay_payment_id — defensive, with an
--     up-front duplicate check that aborts loudly if any exist.
--
-- Status vocabularies:
--   * bookings.payment_status stays UPPERCASE (M007 vocabulary —
--     unchanged here, no live-flow regression).
--   * refunds.status is lowercase ('pending' | 'processed' | 'failed')
--     because the new table can match Razorpay's own values directly.
--
-- Idempotent: safe to re-run after fixing any reported duplicates.

-- =====================================================================
-- 1. Duplicate check on bookings.razorpay_payment_id
-- =====================================================================
-- Razorpay never re-uses payment ids, so duplicates here are always a
-- data-quality issue (manual SQL fix-ups, restore-from-backup mishap,
-- etc.). We refuse to add the UNIQUE constraint silently — report each
-- one as a NOTICE and abort with an EXCEPTION so ops can resolve them
-- before re-running.

DO $$
DECLARE
  r record;
  v_dup_count integer := 0;
BEGIN
  FOR r IN
    SELECT razorpay_payment_id, count(*) AS n
    FROM public.bookings
    WHERE razorpay_payment_id IS NOT NULL
    GROUP BY razorpay_payment_id
    HAVING count(*) > 1
    ORDER BY count(*) DESC
  LOOP
    RAISE NOTICE 'Duplicate razorpay_payment_id: % appears on % bookings', r.razorpay_payment_id, r.n;
    v_dup_count := v_dup_count + 1;
  END LOOP;
  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'Migration 018 aborted: found % duplicate razorpay_payment_id value(s) on bookings. Resolve them (see NOTICE rows above), then re-run.',
      v_dup_count;
  END IF;
END $$;

-- Add the UNIQUE constraint. Using CREATE UNIQUE INDEX (not ADD
-- CONSTRAINT) so we can name it deterministically and use IF NOT EXISTS.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_razorpay_payment_id_unique
  ON public.bookings (razorpay_payment_id);

COMMENT ON INDEX public.bookings_razorpay_payment_id_unique IS
  'One bookings row per Razorpay payment id. Webhook idempotency relies on this — without it, replayed webhook events could ambiguously match multiple bookings.';

-- =====================================================================
-- 2. is_ops_admin() helper
-- =====================================================================
CREATE OR REPLACE FUNCTION public.is_ops_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.ops_users
    WHERE id = auth.uid()
      AND is_active = true
      AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_ops_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_ops_admin() TO authenticated;

COMMENT ON FUNCTION public.is_ops_admin() IS
  'True iff auth.uid() is an active ops_users row with role=''admin''. Use in RLS policies that gate destructive / financial ops (refunds, etc.). is_ops_user() permits both admin + agent; is_ops_admin() permits only admin.';

-- =====================================================================
-- 3. refunds table
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.refunds (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One row per Razorpay refund. The id is opaque ('rfnd_...') and
  -- never reused, so UNIQUE here drives our upsert idempotency.
  razorpay_refund_id  text UNIQUE NOT NULL,
  -- We chose (booking_id, payment_kind) over a payment_id FK because
  -- there is no payments table yet (see migration header).
  booking_id          uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  payment_kind        text NOT NULL CHECK (payment_kind IN ('booking_fee', 'report_fee')),
  amount_paise        integer NOT NULL CHECK (amount_paise > 0),
  status              text NOT NULL CHECK (status IN ('pending', 'processed', 'failed')),
  reason              text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Nullable: webhook-originated refunds (e.g. issued via the Razorpay
  -- dashboard or by /api/razorpay/refund's token-protected legacy path)
  -- have no ops user attribution.
  created_by          uuid REFERENCES public.ops_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_refunds_booking_id
  ON public.refunds (booking_id);
CREATE INDEX IF NOT EXISTS idx_refunds_booking_kind
  ON public.refunds (booking_id, payment_kind);

COMMENT ON TABLE public.refunds IS
  'One row per Razorpay refund. Replaces the single-value bookings.refund_id which couldn''t hold partial-refund history. Upserted by razorpay_refund_id from both the ops admin action and the webhook.';

-- =====================================================================
-- 4. RLS on refunds
-- =====================================================================
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "refunds readable by ops" ON public.refunds;
CREATE POLICY "refunds readable by ops"
  ON public.refunds FOR SELECT TO authenticated
  USING (public.is_ops_user());

-- INSERT/UPDATE for ops admins. In practice the issueRefund() helper
-- uses the service-role client (which bypasses RLS), so these policies
-- only kick in if some future code path writes through an authenticated
-- session. Defence in depth.
DROP POLICY IF EXISTS "refunds insertable by ops admins" ON public.refunds;
CREATE POLICY "refunds insertable by ops admins"
  ON public.refunds FOR INSERT TO authenticated
  WITH CHECK (public.is_ops_admin());

DROP POLICY IF EXISTS "refunds updatable by ops admins" ON public.refunds;
CREATE POLICY "refunds updatable by ops admins"
  ON public.refunds FOR UPDATE TO authenticated
  USING (public.is_ops_admin())
  WITH CHECK (public.is_ops_admin());

-- =====================================================================
-- 5. Backfill from legacy bookings.refund_id
-- =====================================================================
-- Each legacy row had refund_id, refunded_at, refund_amount_paise plus
-- a *_REFUNDED status on exactly one of payment_status / report_payment_status
-- (a single booking is either homecare or diagnostics, never both). Use
-- that to infer payment_kind.
--
-- 'processed' is the only valid backfill status: failed refunds were
-- never persisted to bookings.refund_id in the legacy code.
INSERT INTO public.refunds
  (razorpay_refund_id, booking_id, payment_kind, amount_paise, status, reason, created_at, created_by)
SELECT
  b.refund_id,
  b.id,
  CASE
    WHEN b.payment_status IN ('REFUNDED', 'PARTIAL_REFUND') THEN 'booking_fee'
    WHEN b.report_payment_status = 'REFUNDED'              THEN 'report_fee'
  END AS payment_kind,
  b.refund_amount_paise,
  'processed' AS status,
  NULL AS reason,
  COALESCE(b.refunded_at, b.created_at) AS created_at,
  NULL AS created_by  -- no ops user attribution for historical refunds
FROM public.bookings b
WHERE b.refund_id IS NOT NULL
  AND b.refund_amount_paise IS NOT NULL
  AND b.refund_amount_paise > 0
  AND (
    b.payment_status IN ('REFUNDED', 'PARTIAL_REFUND')
    OR b.report_payment_status = 'REFUNDED'
  )
ON CONFLICT (razorpay_refund_id) DO NOTHING;

-- Backfill summary (visible in the SQL editor Messages panel)
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.refunds;
  RAISE NOTICE 'Migration 018: refunds table now has % rows (after backfill)', v_count;
END $$;

-- =====================================================================
-- 6. payments_v view (security_invoker = true so bookings RLS applies)
-- =====================================================================
-- One row per payment lane. The view emits a row whenever ANY of the
-- razorpay_* / *_status / captured_at columns are set for that lane —
-- including 'CREATED' / 'LINK_SENT' lanes where capture hasn't happened
-- yet, so ops can see pending payments not just captured ones.
--
-- security_invoker=true makes the view run with the calling user's
-- privileges, so bookings RLS (ops-readable-only) flows through. The
-- joined customer is also read under the caller's RLS — if a customer
-- row is unreadable the join produces NULL on those columns rather than
-- exposing it.

CREATE OR REPLACE VIEW public.payments_v
WITH (security_invoker = true) AS

-- Lane 1: booking-fee — homecare / nursing / teleconsult ₹249 partial
-- prepay (and the legacy `amount` integer for pre-Razorpay rows).
SELECT
  b.id                                                  AS booking_id,
  b.booking_code,
  b.customer_id,
  c.customer_code                                       AS customer_code,
  c.full_name                                           AS customer_name,
  b.service_category,
  b.status                                              AS booking_status,
  'booking_fee'::text                                   AS payment_kind,
  b.razorpay_order_id                                   AS razorpay_order_id,
  b.razorpay_payment_id                                 AS razorpay_payment_id,
  COALESCE(b.booking_fee_paid_paise, b.amount * 100, 0)::integer
                                                        AS amount_paise,
  b.payment_status                                      AS status,
  b.payment_captured_at                                 AS captured_at,
  b.created_at                                          AS created_at
FROM public.bookings b
LEFT JOIN public.customers c ON c.id = b.customer_id
WHERE b.razorpay_order_id   IS NOT NULL
   OR b.razorpay_payment_id IS NOT NULL
   OR b.payment_status      IS NOT NULL

UNION ALL

-- Lane 2: report-fee — lab diagnostics post-report payment.
SELECT
  b.id                                                  AS booking_id,
  b.booking_code,
  b.customer_id,
  c.customer_code                                       AS customer_code,
  c.full_name                                           AS customer_name,
  b.service_category,
  b.status                                              AS booking_status,
  'report_fee'::text                                    AS payment_kind,
  b.report_razorpay_order_id                            AS razorpay_order_id,
  b.report_razorpay_payment_id                          AS razorpay_payment_id,
  COALESCE(b.final_amount_paise, b.test_total_paise, 0)::integer
                                                        AS amount_paise,
  b.report_payment_status                               AS status,
  b.report_paid_at                                      AS captured_at,
  b.created_at                                          AS created_at
FROM public.bookings b
LEFT JOIN public.customers c ON c.id = b.customer_id
WHERE b.report_razorpay_order_id   IS NOT NULL
   OR b.report_razorpay_payment_id IS NOT NULL
   OR b.report_payment_status      IS NOT NULL;

GRANT SELECT ON public.payments_v TO authenticated;

COMMENT ON VIEW public.payments_v IS
  'Per-payment-lane projection over bookings. One row per (booking, lane) where lane in (booking_fee, report_fee). security_invoker=true so bookings + customers RLS flow through. The future Pulse build can replace this with a real payments table without changing the read contract on this view.';
