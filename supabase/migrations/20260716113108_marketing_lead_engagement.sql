-- Aarogya Lead Engine P1 — engagement-layer state on marketing_leads + the
-- WABA stop-loss control + the sweep driver. RLS deny-all stays; service-role only.

-- Engagement funnel state per lead.
ALTER TABLE public.marketing_leads
  ADD COLUMN IF NOT EXISTS engagement_state text NOT NULL DEFAULT 'none'
    CHECK (engagement_state IN ('none','t1_sent','t2_sent','replied','opted_out')),
  ADD COLUMN IF NOT EXISTS t1_sent_at    timestamptz,
  ADD COLUMN IF NOT EXISTS t2_sent_at    timestamptz,
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;

-- DB-LEVEL consent guard: a first-contact template (t1/t2) — and any state that
-- can only follow one (replied) — may exist ONLY for a contact-consented source.
-- 'none' and 'opted_out' are allowed for any source (opt-out must always land).
-- founder_referral / google_ctwa join this set when P2/P3 add them to the source enum.
ALTER TABLE public.marketing_leads
  ADD CONSTRAINT marketing_leads_engagement_source_check CHECK (
    engagement_state IN ('none','opted_out')
    OR source = ANY (ARRAY['justdial'::text,'google_lead_form'::text])
  );

-- Eligibility scan for the T1 sweep (pending, not-yet-engaged leads, oldest-first).
CREATE INDEX IF NOT EXISTS idx_marketing_leads_engage_eligible
  ON public.marketing_leads (created_at)
  WHERE engagement_state = 'none' AND consent_status = 'pending';

-- WABA stop-loss kill-switch (singleton). Tripped by haltLeadEngagement(); the
-- sweep refuses to send while halted. Protecting the WABA outranks any lead.
CREATE TABLE IF NOT EXISTS public.marketing_engagement_control (
  id            int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  halted        boolean NOT NULL DEFAULT false,
  halted_reason text,
  halted_at     timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.marketing_engagement_control (id, halted)
  VALUES (1, false) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.marketing_engagement_control ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_marketing_engagement_control_updated_at
  BEFORE UPDATE ON public.marketing_engagement_control
  FOR EACH ROW EXECUTE FUNCTION public.marketing_leads_set_updated_at();

-- Sweep driver (pg_cron + pg_net; Netlify scheduled fns are flaky on nf_team_dev).
-- Every 2h. INERT until Vault has project_url + cron_secret AND the route's
-- AAROGYA_LEAD_ENGAGE_ENABLED flag is 'true'.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
DO $$ BEGIN PERFORM cron.unschedule('lead-engagement-sweep'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'lead-engagement-sweep',
  '23 */2 * * *',
  $cron$
    DO $body$
    DECLARE v_url text; v_secret text;
    BEGIN
      SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
      SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
      IF v_url IS NULL OR v_secret IS NULL THEN
        RAISE NOTICE 'lead-engagement-sweep: vault secrets not set — skipping';
        RETURN;
      END IF;
      PERFORM net.http_post(
        url := v_url || '/api/cron/lead-engagement-sweep',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    END $body$;
  $cron$
);
