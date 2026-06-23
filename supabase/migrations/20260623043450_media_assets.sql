-- Aarogya media + vision foundation — media_assets retention ledger.
-- One row per persisted inbound media asset (consumers that STORE write here;
-- the patient photo-ack consumer does NOT persist). purgeExpiredMedia() deletes
-- rows past purge_after + their storage objects. RLS deny-all; supabaseAdmin only.
--
-- Applied via Supabase MCP; file prefix == recorded version 20260623043450.
CREATE TABLE IF NOT EXISTS public.media_assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id     text NOT NULL,                 -- Meta Cloud API media id (provenance)
  owner_id     uuid,                          -- customer/conversation owner, when known
  bucket       text NOT NULL,                 -- private Supabase Storage bucket
  path         text NOT NULL,                 -- object path within the bucket
  mime         text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  purge_after  timestamptz                    -- null = no auto-purge; set by the consumer
);

CREATE INDEX IF NOT EXISTS idx_media_assets_purge
  ON public.media_assets (purge_after)
  WHERE purge_after IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_assets_media_id
  ON public.media_assets (media_id);

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.media_assets IS
  'Retention ledger for persisted inbound WhatsApp media (Aarogya vision foundation). RLS deny-all; all I/O via supabaseAdmin. purgeExpiredMedia() (src/lib/whatsapp/mediaStore.ts) deletes rows past purge_after + their storage objects; cron wiring deferred to consumers.';
