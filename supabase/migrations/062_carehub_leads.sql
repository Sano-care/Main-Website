-- M062 — Aarogya Slice 5 (CareHub awareness) — carehub_leads.
--
-- Chat-side CareHub interest capture. When a non-member expresses interest
-- in CareHub during an Aarogya conversation, register_carehub_interest writes
-- a row here so sales can follow up. Also fed by the website signup funnel and
-- ops manual entry (source column distinguishes).
--
-- phone is NOT NULL so a brand-new visitor (no customers row yet) is still a
-- usable lead; customer_id links the row to a known customer when one exists.
-- contacted_at / converted_subscription_id are the terminal columns the sales
-- workflow stamps.
--
-- RLS: deny-all (no policies). Writes/reads via supabaseAdmin only, per the
-- project-wide RLS-deny-all-tables rule.
--
-- NOTE (reconciliation): already LIVE in prod (applied 2026-06-20 via MCP
-- alongside M061). IF NOT EXISTS makes this a no-op against the existing prod
-- table while restoring repo↔prod parity.
--
-- Reversibility:
--   DROP TABLE carehub_leads;

BEGIN;

CREATE TABLE IF NOT EXISTS carehub_leads (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id              UUID REFERENCES customers(id) ON DELETE SET NULL,
  phone                    TEXT NOT NULL,           -- new visitors with no customer record yet
  source                   TEXT NOT NULL,           -- 'aarogya_chat', 'sanocare_in', 'ops'
  source_message_id        UUID REFERENCES messages(id) ON DELETE SET NULL,
  notes                    TEXT,                    -- the patient's reason for interest, if expressed
  contacted_at             TIMESTAMPTZ,             -- when sales reaches out
  converted_subscription_id UUID REFERENCES carehub_subscriptions(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index: the sales queue ("show me leads nobody has contacted or
-- converted yet") is the only hot read on this table.
CREATE INDEX IF NOT EXISTS idx_carehub_leads_pending ON carehub_leads(created_at)
  WHERE contacted_at IS NULL AND converted_subscription_id IS NULL;

ALTER TABLE carehub_leads ENABLE ROW LEVEL SECURITY;

COMMIT;
