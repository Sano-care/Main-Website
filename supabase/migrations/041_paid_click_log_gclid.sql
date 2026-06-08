-- Migration 040: paid_click_log.gclid
--
-- The /book-* landing pages beacon the Google Click ID (gclid) to
-- /api/paid-click-log. Capturing it lets paid clicks be matched back to Google
-- Ads (offline-conversion import / dedup) later. Additive, nullable.
-- apply_migration wraps its own transaction.

ALTER TABLE public.paid_click_log ADD COLUMN IF NOT EXISTS gclid text;

CREATE INDEX IF NOT EXISTS idx_paid_click_log_gclid
  ON public.paid_click_log (gclid)
  WHERE gclid IS NOT NULL;
