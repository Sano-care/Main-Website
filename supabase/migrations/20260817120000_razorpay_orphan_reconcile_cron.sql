-- P0 revenue safety net (part 2) — active Razorpay orphan reconciliation.
--
-- The /api/razorpay/webhook safety net (migration 20260720120000) only fires if
-- Razorpay is configured to call it. In prod it produced ZERO reconciliation
-- stubs across Jun–Aug 2026 (webhook never wired in the Razorpay dashboard), so
-- 38 captured payments (₹6,100) leaked with no booking and no alert. The
-- payment-leak-monitor cron only watches existing stubs + pipeline silence —
-- neither notices a captured payment that simply never became a booking.
--
-- This schedules /api/cron/razorpay-reconcile, which polls Razorpay directly
-- for recently-captured payments (default 6h window) and ensures each has a
-- booking, creating a reconciliation stub + loud ops alert for any orphan. It
-- is the ACTIVE backstop that does not depend on the webhook being wired.
--
-- INERT until Vault has project_url + cron_secret (same secrets the other
-- pg_cron drivers read) AND the route's CRON_SECRET matches. Every 15 min so
-- consecutive 6h-window runs overlap and nothing slips between them.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$ BEGIN PERFORM cron.unschedule('razorpay-orphan-reconcile'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'razorpay-orphan-reconcile',
  '*/15 * * * *',
  $cron$
    DO $body$
    DECLARE v_url text; v_secret text;
    BEGIN
      SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
      SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
      IF v_url IS NULL OR v_secret IS NULL THEN
        RAISE NOTICE 'razorpay-orphan-reconcile: vault secrets not set — skipping';
        RETURN;
      END IF;
      PERFORM net.http_post(
        url := v_url || '/api/cron/razorpay-reconcile',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    END $body$;
  $cron$
);
