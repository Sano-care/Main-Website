-- M061 — Aarogya Slice 5 (CareHub awareness) — carehub_subscriptions.
--
-- One row per active/lapsed CareHub membership. CareHub is the ₹199/month
-- membership: 1 free monthly vitals visit, 20% off all services, priority
-- medic dispatch. v1 covers the primary customer only (seats defaults to 1;
-- family expansion is a later slice).
--
-- Cancellation is honor-through-cycle: cancelled_at marks when the patient
-- asked to cancel, cancellation_effective_at is the period end, and active
-- stays TRUE until that date passes (ops/cron flips it — not this slice).
--
-- RLS: deny-all (no policies). Reads go through supabaseAdmin only, per the
-- project-wide RLS-deny-all-tables rule (the agent's customer/PII tables are
-- all service-role-only). The anon/authenticated roles get nothing.
--
-- NOTE (reconciliation): this schema is already LIVE in prod (applied
-- 2026-06-20 via MCP, ahead of the application code). This file is the
-- in-repo source of truth that was missing — IF NOT EXISTS makes it a no-op
-- against the existing prod table while restoring repo↔prod parity.
--
-- Reversibility:
--   DROP TABLE carehub_subscriptions;

BEGIN;

CREATE TABLE IF NOT EXISTS carehub_subscriptions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id               UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  started_at                TIMESTAMPTZ NOT NULL,
  cancelled_at              TIMESTAMPTZ,
  cancellation_effective_at TIMESTAMPTZ,            -- honors through cycle end
  cycle                     TEXT NOT NULL CHECK (cycle IN ('monthly', 'quarterly', 'annual')),
  monthly_inr               INTEGER NOT NULL CHECK (monthly_inr > 0),
  active                    BOOLEAN NOT NULL DEFAULT true,
  auto_renew                BOOLEAN NOT NULL DEFAULT true,
  seats                     INTEGER NOT NULL DEFAULT 1 CHECK (seats >= 1),
  source                    TEXT,                   -- 'website_signup', 'aarogya_chat', 'ops_signup'
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index: the loader + identity resolver only ever ask "does this
-- customer have an ACTIVE subscription?" — keep that lookup cheap.
CREATE INDEX IF NOT EXISTS idx_carehub_active ON carehub_subscriptions(customer_id)
  WHERE active = true;

-- RLS deny-all (per project-sanocare-rls-deny-all-tables convention).
-- No policies = deny all by default. Reads via supabaseAdmin only.
ALTER TABLE carehub_subscriptions ENABLE ROW LEVEL SECURITY;

COMMIT;
