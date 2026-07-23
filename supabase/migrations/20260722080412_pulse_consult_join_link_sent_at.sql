-- PB4a — join-link cron idempotency marker.
--
-- The native teleconsult flow defers the /c/<token> WhatsApp to a scheduled
-- sender (netlify/functions/cron-consult-join → POST /api/cron/consult-join),
-- which fires ~10 min before consultation_sessions.scheduled_at. This nullable
-- timestamp is the once-only guard: the cron only sends where join_link_sent_at
-- IS NULL, and stamps it on a successful send so no session is double-notified.
--
-- Applied to prod via the Supabase MCP (version 20260722080412); this file's
-- prefix matches the recorded version so the CLI treats it as already-applied.

ALTER TABLE public.consultation_sessions
  ADD COLUMN IF NOT EXISTS join_link_sent_at timestamptz;

COMMENT ON COLUMN public.consultation_sessions.join_link_sent_at IS
  'PB4a — set by the consult-join cron when the /c/<token> WhatsApp is sent (~10 min before scheduled_at). NULL = not yet sent; idempotency marker preventing double-sends.';
