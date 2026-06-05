-- Migration 038: paid_click_log — server-side paid-ad click attribution
--
-- One row per hit on /wa (the single conversion-redirect endpoint for every
-- paid channel: Google Ads now, Meta CTWA + LinkedIn later). This is the
-- DPDP-safe, cookieless source of truth for paid attribution — it does not
-- depend on the client-side GA4/Pixel/Ads fires (which are consent-gated and
-- can be blocked / modelled).
--
-- DPDP: NO raw IP is ever stored. ip_hash = sha256(client_ip || IP_SALT); if
-- IP_SALT is unset the route stores NULL rather than a weak/raw value. No name,
-- phone, or email is collected here — those only exist later in WhatsApp.
-- Retention: 90 days (matches the site DPDP rule). The purge job is a separate
-- follow-up (no cron infra wired yet); idx on created_at supports it.
--
-- RLS ENABLED, no policies: written only by the service-role client
-- (supabaseAdmin, which bypasses RLS); the public anon key is denied. Same
-- deny-by-default posture as the WhatsApp-agent tables.
--
-- Numbered 038 to clear the 034–037 slots already taken across in-flight
-- branches (callback_requests, whatsapp_agent, vital_readings, medications,
-- service_intent_teleconsult). apply_migration wraps its own transaction.

CREATE TABLE IF NOT EXISTS public.paid_click_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service       text NOT NULL                       -- normalised slug
                  CHECK (service IN ('home_visit','nursing','lab','teleconsult','other')),
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_content   text,
  utm_term      text,
  referrer      text,
  user_agent    text,
  ip_hash       text,                                -- sha256(ip || IP_SALT); never raw IP
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.paid_click_log IS
  'One row per /wa paid-ad click. Cookieless, DPDP-safe attribution source of '
  'truth (independent of client-side GA4/Pixel/Ads). ip_hash is '
  'sha256(client_ip || IP_SALT) or NULL — never a raw IP. 90-day retention.';

CREATE INDEX IF NOT EXISTS idx_paid_click_log_created_at
  ON public.paid_click_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_paid_click_log_campaign_created
  ON public.paid_click_log (utm_campaign, created_at DESC)
  WHERE utm_campaign IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_paid_click_log_service_created
  ON public.paid_click_log (service, created_at DESC);

ALTER TABLE public.paid_click_log ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE present int;
BEGIN
  SELECT count(*) INTO present FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'paid_click_log';
  RAISE NOTICE 'paid_click_log present=% (expected 1)', present;
END $$;
