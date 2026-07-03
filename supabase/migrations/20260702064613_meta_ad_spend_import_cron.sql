-- Meta Ads spend importer — pg_cron + pg_net driver (Netlify scheduled functions
-- are flaky on nf_team_dev). Every ~6h, POST the secret-gated Next route which
-- pulls Meta campaign spend into marketing_ad_spend.
--
-- INERT until BOTH Vault secrets exist: `project_url` (site base URL) and
-- `cron_secret` (= CRON_SECRET). Absent → the job RAISE NOTICEs and returns,
-- writing nothing. The route is independently inert until META_ADS_ACCESS_TOKEN.
--
-- Reversibility: SELECT cron.unschedule('meta-ad-spend-import');
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$ BEGIN
  PERFORM cron.unschedule('meta-ad-spend-import');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'meta-ad-spend-import',
  '17 */6 * * *',   -- every 6h at :17 (off the top-of-hour thundering herd)
  $cron$
    DO $body$
    DECLARE
      v_url    text;
      v_secret text;
    BEGIN
      SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
      SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
      IF v_url IS NULL OR v_secret IS NULL THEN
        RAISE NOTICE 'meta-ad-spend-import: vault secrets project_url/cron_secret not set — skipping';
        RETURN;
      END IF;
      PERFORM net.http_post(
        url := v_url || '/api/cron/meta-ad-spend-import',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    END $body$;
  $cron$
);
