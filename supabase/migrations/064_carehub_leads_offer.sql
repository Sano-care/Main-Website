-- M064 — Aarogya Slice 5b — carehub_leads proactive-offer columns.
--
-- Feature A sends the APPROVED MARKETING template `aarogya_carehub_offer` to a
-- lead at most ONCE, ever. These columns record that send so the sweep is
-- idempotent and never re-offers.
--
-- NOTE on numbering: the Slice 5b brief called this "M063", but
-- 063_presence_to_attendance (the C3 presence→payroll slice) already occupies
-- 063 in the live ladder. This is 064; the reminder log is 065.
--
-- RLS: carehub_leads is already deny-all (M062). These are additive columns on
-- that table — all reads/writes stay on supabaseAdmin. No policy change.
--
-- Reversibility:
--   DROP INDEX IF EXISTS idx_carehub_leads_offer_pending;
--   ALTER TABLE carehub_leads
--     DROP COLUMN offer_sent_at, DROP COLUMN offer_send_count, DROP COLUMN offer_last_wamid;

BEGIN;

ALTER TABLE carehub_leads
  ADD COLUMN IF NOT EXISTS offer_sent_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offer_send_count  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS offer_last_wamid  TEXT;

COMMENT ON COLUMN carehub_leads.offer_sent_at IS
  'When the aarogya_carehub_offer MARKETING template was sent to this lead. Non-null = already offered; the sweep never re-offers (one offer per lead, ever).';
COMMENT ON COLUMN carehub_leads.offer_send_count IS
  'Count of offer sends (should be 0 or 1; >1 would indicate a bug — the partial index + offer_sent_at guard prevent re-offer).';
COMMENT ON COLUMN carehub_leads.offer_last_wamid IS
  'Provider message id (wamid) of the last offer send, for traceability.';

-- The Feature-A hot read: "un-actioned leads we have never offered". Mirrors
-- M062's idx_carehub_leads_pending but adds the offer_sent_at IS NULL arm so
-- the sweep scans only genuinely-pending, never-offered rows.
CREATE INDEX IF NOT EXISTS idx_carehub_leads_offer_pending
  ON carehub_leads (created_at)
  WHERE contacted_at IS NULL
    AND converted_subscription_id IS NULL
    AND offer_sent_at IS NULL;

COMMIT;
