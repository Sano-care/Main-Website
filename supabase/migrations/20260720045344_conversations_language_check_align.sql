-- Fix the conversations.language 400 spam. The agent code writes + reads the
-- long-form kind ('english'/'hindi'/'hinglish' — detectLanguage + loadStoredLanguage),
-- but the CHECK allowed short codes ('en'/'hi') the code never emits, so every
-- english/hindi turn violated the constraint (PATCH /conversations 400). Align the
-- CHECK to the code contract. Order matters: DROP the old CHECK BEFORE backfilling
-- the legacy short-code rows (else the backfill trips the very constraint being
-- replaced). Applied live 2026-07-20 (recorded version == filename prefix).
ALTER TABLE public.conversations DROP CONSTRAINT conversations_language_check;

UPDATE public.conversations SET language = 'english' WHERE language = 'en';
UPDATE public.conversations SET language = 'hindi'   WHERE language = 'hi';

ALTER TABLE public.conversations ADD CONSTRAINT conversations_language_check
  CHECK (language = ANY (ARRAY['english'::text, 'hindi'::text, 'hinglish'::text]));
