-- Aarogya — ops media viewing + 3-day chat-media retention.
-- ops_media is the single registry for ops-viewable INBOUND chat media (the
-- medic-attendance-selfie path registers here too, sender_role='medic'). Files
-- live in the private ops-media bucket; a scheduled purge deletes the object +
-- soft-deletes the row after purge_after. Deny-all RLS; service-role only.
-- This is the EPHEMERAL ops-viewing copy — separate from pulse_documents
-- (consented vault, not purged) and the clinical buckets (never touched by purge).
--
-- Applied via Supabase MCP; recorded version = this file's prefix (20260624181159).
CREATE TABLE public.ops_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_role text NOT NULL,
  media_kind text NOT NULL CHECK (media_kind IN ('image','document')),
  media_id text NOT NULL,
  file_path text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  received_at timestamptz NOT NULL DEFAULT now(),
  purge_after timestamptz NOT NULL,
  deleted_at timestamptz
);

CREATE INDEX idx_ops_media_message ON public.ops_media(message_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_ops_media_purge ON public.ops_media(purge_after) WHERE deleted_at IS NULL;

ALTER TABLE public.ops_media ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ops_media IS
  'Single registry of ops-viewable inbound chat media (customer WhatsApp + medic selfie). Files in the private ops-media bucket; scheduled purge deletes object + soft-deletes row after purge_after (customer/medic = +72h). Ephemeral ops-viewing copy — NOT the pulse_documents vault. Deny-all RLS; service-role only.';
COMMENT ON COLUMN public.ops_media.purge_after IS
  'Per-row TTL. customer chat media = received_at + 72h (3 days); medic selfie = received_at + 72h. The purge cron deletes object + soft-deletes only where purge_after < now().';

-- Private India-region bucket (ap-south-1), mirroring pulse-documents/medic-documents.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ops-media',
  'ops-media',
  false,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO NOTHING;
