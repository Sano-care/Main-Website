-- Marketing Agent Slice 1 — the multi-source lead spine. Superset table that
-- LINKS to leads + bookings (does not overload them). RLS deny-all; only the
-- service-role client (which bypasses RLS) touches it.
CREATE TABLE public.marketing_leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  source          text NOT NULL CHECK (source IN (
                    'meta_ctwa','meta_lead_ad','google_lead_form','website_book',
                    'website_callback','justdial','whatsapp_inbound','b2b_discovery')),
  campaign        text,
  utm_source      text,
  utm_medium      text,
  utm_content     text,
  utm_term        text,
  gclid           text,

  consent_status  text NOT NULL DEFAULT 'none'
                    CHECK (consent_status IN ('opted_in','pending','none','opted_out')),
  score           int  NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  state           text NOT NULL DEFAULT 'new'
                    CHECK (state IN ('new','qualified','nurturing','hot','booked','lost','b2b_prospect')),

  contact         jsonb NOT NULL DEFAULT '{}'::jsonb,           -- { phone, whatsapp, email }
  -- Top-level source/campaign/utm = FIRST touch (immutable on dedupe);
  -- last_touch jsonb = most recent touch {source,campaign,utm,at}.
  last_touch      jsonb,
  normalized_phone text,                                        -- last-10, maintained by intake
  email_lc        text,
  service_intent  text CHECK (service_intent IS NULL OR service_intent IN (
                    'gda','medic_home','teleconsult','lab','clinic_partner','society')),

  linked_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  linked_lead_id    uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  lifetime_value    numeric NOT NULL DEFAULT 0,

  -- Aarogya-nurture enqueue flag. THE consent invariant lives here as a DB CHECK:
  -- it can only be true for an opted-in lead, so a non-opted-in Aarogya enqueue
  -- is physically impossible (WABA-ban + DPDP) — not merely an app-layer rule.
  aarogya_nurture boolean NOT NULL DEFAULT false,
  CONSTRAINT marketing_leads_aarogya_consent_check
    CHECK (aarogya_nurture = false OR consent_status = 'opted_in'),

  assigned_to     text,
  routed_at       timestamptz,
  notes           text
);

-- B2C dedupe: one row per phone when a phone is present.
CREATE UNIQUE INDEX uq_marketing_leads_norm_phone
  ON public.marketing_leads (normalized_phone) WHERE normalized_phone IS NOT NULL;
CREATE INDEX idx_marketing_leads_state   ON public.marketing_leads (state);
CREATE INDEX idx_marketing_leads_consent ON public.marketing_leads (consent_status);
CREATE INDEX idx_marketing_leads_source  ON public.marketing_leads (source);

-- updated_at maintenance.
CREATE OR REPLACE FUNCTION public.marketing_leads_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER trg_marketing_leads_updated_at
  BEFORE UPDATE ON public.marketing_leads
  FOR EACH ROW EXECUTE FUNCTION public.marketing_leads_set_updated_at();

ALTER TABLE public.marketing_leads ENABLE ROW LEVEL SECURITY;
-- No policies → deny-all to anon/authenticated; service-role bypasses RLS.

COMMENT ON CONSTRAINT marketing_leads_aarogya_consent_check ON public.marketing_leads IS
  'DB-level consent invariant: aarogya_nurture may be true only when consent_status=opted_in.';
