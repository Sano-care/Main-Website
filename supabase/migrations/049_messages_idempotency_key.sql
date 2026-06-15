-- M049 — Slice 2b: outbound idempotency key on messages.
--
-- Lets the hardened sender dedupe a logical outbound message (same
-- conversation + same content within the same minute bucket) so a
-- double-fired event or a serverless retry can't double-send. The sender
-- computes sha256(conversation_id : sha256(content) : minuteBucket) and looks
-- for a row with the same key in the last 5 minutes before calling Meta.
--
-- Additive + nullable: safe to apply against an empty table or a populated one
-- (existing rows keep idempotency_key = NULL and are simply never dedupe-matched).
-- Idempotent (IF NOT EXISTS) so it's safe to ship even before deploy.
--
-- ROLLBACK (manual, if ever needed):
--   DROP INDEX IF EXISTS public.idx_messages_idempotency_key;
--   ALTER TABLE public.messages DROP COLUMN IF EXISTS idempotency_key;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Partial index: only non-null keys are ever queried (outbound sends), so the
-- index stays small and inbound rows don't bloat it. Ordered by created_at DESC
-- to serve the "most recent match in the last 5 minutes" lookup directly.
CREATE INDEX IF NOT EXISTS idx_messages_idempotency_key
  ON public.messages (idempotency_key, created_at DESC)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.messages.idempotency_key IS
  'Slice 2b outbound dedupe key: sha256(conversation_id:sha256(content):minuteBucket). NULL for inbound + pre-M049 rows.';
