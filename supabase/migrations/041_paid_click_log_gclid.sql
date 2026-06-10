-- Migration 041: paid_click_log.gclid
--
-- (Renumbered from 040 by T64 PR1 — see T64_BRIEF_PATCH.md divergence 4.
-- Body unchanged from the original PR #43 authoring; only the file
-- number moved to resolve the M040 collision.)
--
-- The /book-* landing pages beacon the Google Click ID (gclid) to
-- /api/paid-click-log. Capturing it lets paid clicks be matched back to Google
-- Ads (offline-conversion import / dedup) later. Additive, nullable.
-- apply_migration wraps its own transaction.

ALTER TABLE public.paid_click_log ADD COLUMN IF NOT EXISTS gclid text;

CREATE INDEX IF NOT EXISTS idx_paid_click_log_gclid
  ON public.paid_click_log (gclid)
  WHERE gclid IS NOT NULL;
