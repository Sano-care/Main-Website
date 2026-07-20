-- P0 revenue safety net — Razorpay captured-payment-without-booking leak.
--
-- A booking is written only when the patient's browser calls
-- /api/razorpay/verify after Razorpay Checkout succeeds. Razorpay
-- auto-captures the payment, so a tab-close / network-drop between capture
-- and verify takes the money with NO booking row (>=4 orphan captures
-- Jul 14-19, already made whole manually by the founder). The
-- /api/razorpay/webhook endpoint is now the server-side backstop: it inserts
-- a reconciliation booking for any captured order that has no row and alerts
-- ops. This migration adds the two DB-level pieces that make that safe:
--
--   1. A PARTIAL UNIQUE index on bookings(razorpay_order_id) — the
--      idempotency backstop. It guarantees the webhook and verify can never
--      both create a duplicate booking for the same order, no matter how they
--      race (the loser gets a 23505 that the app swallows as success).
--      PARTIAL because 51 live rows have NULL razorpay_order_id (manual /
--      lab-at-door bookings) and must stay allowed. 0 duplicate non-null
--      order ids exist today, so it applies cleanly. Not built CONCURRENTLY:
--      the Supabase migration runner wraps statements in a transaction, and
--      at ~25 non-null rows a plain build is instant.
--
--   2. A pg_cron dead-man's switch (POSTs the secret-gated
--      /api/cron/payment-leak-monitor every 30 min) as a second backstop:
--      re-alerts on un-reconciled stubs and on a silent booking pipeline.

CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_razorpay_order_id
  ON public.bookings (razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;

-- Dead-man's switch. INERT until Vault has project_url + cron_secret (same
-- secrets the other pg_cron drivers read) AND the route's CRON_SECRET matches.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
DO $$ BEGIN PERFORM cron.unschedule('payment-leak-monitor'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'payment-leak-monitor',
  '*/30 * * * *',
  $cron$
    DO $body$
    DECLARE v_url text; v_secret text;
    BEGIN
      SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
      SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
      IF v_url IS NULL OR v_secret IS NULL THEN
        RAISE NOTICE 'payment-leak-monitor: vault secrets not set — skipping';
        RETURN;
      END IF;
      PERFORM net.http_post(
        url := v_url || '/api/cron/payment-leak-monitor',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    END $body$;
  $cron$
);
