-- Marketing Agent Slice 2 — ad-spend ingest for the closed-loop CAC/ROAS view.
-- Source enum aligned to marketing_leads.source. RLS deny-all; service-role only.
-- Spend is entered manually now (secret-gated import) and by the Meta/Google MCP
-- later — the view is only as accurate as the spend fed in.
CREATE TABLE public.marketing_ad_spend (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date        date NOT NULL,
  source      text NOT NULL CHECK (source IN (
                'meta_ctwa','meta_lead_ad','google_lead_form','website_book',
                'website_callback','justdial','whatsapp_inbound','b2b_discovery')),
  campaign    text NOT NULL,                       -- matches marketing_leads.campaign / utm_campaign
  spend_paise bigint NOT NULL DEFAULT 0 CHECK (spend_paise >= 0),
  impressions int CHECK (impressions IS NULL OR impressions >= 0),
  clicks      int CHECK (clicks IS NULL OR clicks >= 0),
  currency    text NOT NULL DEFAULT 'INR',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_marketing_ad_spend_src_camp_date UNIQUE (source, campaign, date)
);

CREATE INDEX idx_marketing_ad_spend_date   ON public.marketing_ad_spend (date);
CREATE INDEX idx_marketing_ad_spend_source ON public.marketing_ad_spend (source, campaign);

-- Reuses the marketing_leads_set_updated_at() trigger fn from Slice 1.
CREATE TRIGGER trg_marketing_ad_spend_updated_at
  BEFORE UPDATE ON public.marketing_ad_spend
  FOR EACH ROW EXECUTE FUNCTION public.marketing_leads_set_updated_at();

ALTER TABLE public.marketing_ad_spend ENABLE ROW LEVEL SECURITY;
-- No policies → deny-all to anon/authenticated; service-role bypasses RLS.
