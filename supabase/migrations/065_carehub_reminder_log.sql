-- M065 — Aarogya Slice 5b — carehub_reminder_log.
--
-- Feature B sends the UTILITY template `aarogya_carehub_monthly_visit_reminder`
-- once per active member per calendar month. This ledger is the REAL dedupe:
-- the UNIQUE(subscription_id, period_yyyymm, reminder_type) constraint makes a
-- double-send impossible even under concurrent cron runs — the second insert
-- raises a unique violation and that member is skipped. (The "already booked a
-- visit this month" check is a soft suppression on top; the ledger is the hard
-- guarantee.)
--
-- period_yyyymm is the IST calendar month ("YYYYMM") the reminder is for —
-- computed app-side so the month boundary is IST, not UTC.
--
-- RLS: deny-all (no policies), per project-sanocare-rls-deny-all-tables. All
-- I/O via supabaseAdmin.
--
-- Reversibility:
--   DROP TABLE carehub_reminder_log;

BEGIN;

CREATE TABLE IF NOT EXISTS carehub_reminder_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES carehub_subscriptions(id) ON DELETE CASCADE,
  period_yyyymm   TEXT NOT NULL,                       -- IST calendar month, e.g. '202606'
  reminder_type   TEXT NOT NULL DEFAULT 'monthly_visit',
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  wamid           TEXT,
  UNIQUE (subscription_id, period_yyyymm, reminder_type)
);

CREATE INDEX IF NOT EXISTS idx_carehub_reminder_log_sub
  ON carehub_reminder_log (subscription_id, period_yyyymm);

ALTER TABLE carehub_reminder_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE carehub_reminder_log IS
  'One row per (subscription, IST month, reminder_type) — the hard dedupe ledger for the CareHub monthly home-visit reminder. UNIQUE makes concurrent cron runs safe. RLS deny-all; supabaseAdmin only.';

COMMIT;
