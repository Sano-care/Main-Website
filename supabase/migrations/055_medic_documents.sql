-- M055: medic_documents + medic_doc_access_log
--
-- T65 Phase 2 Hub — PII docs (Aadhar/PAN/certs/photo) + payout proof
-- screenshots share this surface. Treated with KYC-level care per CLAUDE.md
-- (off-limits unless explicitly named; same posture as _KYC_DO_NOT_INDEX/).
--
-- Soft delete (deleted_at + deleted_by): docs are PII + payout proofs,
-- irreversible deletion is too risky. A separate cron purges Storage objects
-- N days after deleted_at is set.
--
-- File size CHECK enforces 10 MB cap matching the Storage bucket policy.
-- MIME CHECK enforces the same whitelist as the bucket — defence in depth.

CREATE TABLE medic_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medic_id UUID NOT NULL REFERENCES medics(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL CHECK (doc_type IN (
    'gnm_cert','bsc_cert','registration_card','aadhar','pan',
    'photo','address_proof','offer_letter','payout_proof','other'
  )),
  file_path TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  label TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by UUID REFERENCES ops_users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES ops_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_medic_docs_medic_type ON medic_documents(medic_id, doc_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_medic_docs_uploaded   ON medic_documents(uploaded_at DESC);

CREATE TABLE medic_doc_access_log (
  id BIGSERIAL PRIMARY KEY,
  doc_id UUID NOT NULL REFERENCES medic_documents(id) ON DELETE CASCADE,
  accessed_by UUID NOT NULL REFERENCES ops_users(id) ON DELETE RESTRICT,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent TEXT,
  ip_hash TEXT
);
CREATE INDEX idx_doc_access_doc ON medic_doc_access_log(doc_id, accessed_at DESC);

COMMENT ON TABLE medic_documents IS
  'T65 Phase 2 — medic PII docs (cert/Aadhar/PAN/photo) + payout proof images. Soft-delete via deleted_at. Storage bucket: medic-documents (private, admin-RLS).';
COMMENT ON TABLE medic_doc_access_log IS
  'T65 Phase 2 — DPDP audit. One row per signed-URL generation. ip_hash is SHA256(ip), never raw.';
