-- Hotfix (already applied to live DB; this file records it so the CLI sees it as
-- already-applied — the filename prefix MUST equal the recorded version
-- 20260627034703; do NOT re-run or change the version).
--
-- #112 writes medications.source='aarogya_whatsapp' for chat-set reminders, but
-- medications_source_check only allowed ('manual','rx_import') — so every
-- chat-set insert failed in prod with "violates check constraint
-- medications_source_check". The unit tests mock supabaseAdmin, so the real
-- constraint was never exercised. Widen the allow-list to include the chat source.
ALTER TABLE public.medications DROP CONSTRAINT medications_source_check;
ALTER TABLE public.medications ADD CONSTRAINT medications_source_check CHECK (source = ANY (ARRAY['manual'::text,'rx_import'::text,'aarogya_whatsapp'::text]));
