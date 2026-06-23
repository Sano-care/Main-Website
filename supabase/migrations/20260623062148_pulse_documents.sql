-- Slice A — Pulse Documents vault: metadata table + access log + Storage bucket.
--
-- Mirrors the medic_documents conventions (M055) for a patient-facing vault:
--   * private India-region Storage bucket 'pulse-documents' (project region ap-south-1)
--   * 10 MB file cap + MIME whitelist enforced at BOTH the bucket and the CHECK
--     constraints (defence in depth)
--   * 600s signed-URL TTL is applied in code (Slice C), never a public URL
--   * upload-then-rollback on metadata-insert failure is handled in code (Slice C)
--   * one access-log row per signed-URL generation, ip_hash = SHA256(ip + salt),
--     never raw IP (DPDP)
--
-- Scope: customer_id NOT NULL; member_id nullable FK (NULL = account holder).
-- Soft delete (deleted_at) — documents are patient health records; a later cron
-- purges Storage objects N days after deleted_at (out of scope this slice).
-- Deny-all RLS + service-role + code-level customer_id scoping.
--
-- Applied via Supabase MCP; recorded version = this file's prefix (20260623062148).

CREATE TABLE public.pulse_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.family_members(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN (
    'lab_report','prescription','imaging','discharge_summary','other'
  )),
  file_path text NOT NULL,
  file_size_bytes integer NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  label text,
  source text NOT NULL DEFAULT 'pulse_upload' CHECK (source IN ('pulse_upload','whatsapp_aarogya')),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pulse_documents_customer ON public.pulse_documents(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_pulse_documents_member ON public.pulse_documents(member_id) WHERE member_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE public.pulse_documents ENABLE ROW LEVEL SECURITY;

-- DPDP access log — one row per signed-URL generation, written BEFORE the URL
-- is minted (clone of medic_doc_access_log). accessor encodes who pulled it:
-- 'pulse:{customer_id}' (patient in Pulse) or 'aarogya:{customer_id}' (Aarogya on
-- the patient's behalf). ip_hash is SHA256(ip + salt), never the raw IP.
CREATE TABLE public.pulse_document_access_log (
  id bigserial PRIMARY KEY,
  doc_id uuid NOT NULL REFERENCES public.pulse_documents(id) ON DELETE CASCADE,
  accessor text NOT NULL,
  accessed_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text
);

CREATE INDEX idx_pulse_doc_access_doc ON public.pulse_document_access_log(doc_id, accessed_at DESC);

ALTER TABLE public.pulse_document_access_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.pulse_documents IS
  'Slice A: patient Documents vault metadata (Pulse + Aarogya). Files live in the private pulse-documents Storage bucket. Soft-delete via deleted_at. Deny-all RLS; service-role + code-level customer_id scoping.';
COMMENT ON COLUMN public.pulse_documents.member_id IS
  'Nullable FK to family_members. NULL = account holder; non-null = that family member. ON DELETE CASCADE.';
COMMENT ON COLUMN public.pulse_documents.source IS
  'pulse_upload = patient uploaded in Pulse; whatsapp_aarogya = received via WhatsApp and filed by Aarogya into the vault.';
COMMENT ON TABLE public.pulse_document_access_log IS
  'Slice A DPDP audit — one row per signed-URL generation. accessor = pulse:{customer_id} | aarogya:{customer_id}. ip_hash is SHA256(ip + salt), never raw.';

-- Private India-region bucket, mirroring medic-documents (10 MB cap + MIME whitelist).
-- Idempotent so a re-run (or CLI replay) is a no-op.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pulse-documents',
  'pulse-documents',
  false,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO NOTHING;
