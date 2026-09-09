-- Applied to prod 2026-07-25 via the Supabase MCP during a P0; this file is
-- the retrospective source of record. Recorded version: 20260725103143.
--
-- conversations.language had DEFAULT 'en', but migration
-- 20260720045344_conversations_language_check_align installed
-- conversations_language_check allowing only ('english','hindi','hinglish').
-- Every INSERT that omitted `language` therefore violated the CHECK, so no
-- conversation row could be created — WhatsApp threads silently stopped
-- appearing in /ops while customers and leads kept being written.
--
-- The default is realigned to a value the CHECK permits.

ALTER TABLE public.conversations
  ALTER COLUMN language SET DEFAULT 'english';
