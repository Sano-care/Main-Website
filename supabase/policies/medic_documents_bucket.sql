-- T65 Phase 2 Hub — medic-documents Storage bucket + RLS
--
-- Private bucket, 10 MB cap, whitelist MIME (jpeg/png/webp/pdf).
-- Path convention enforced at API layer: {medic_id}/{doc_type}/{uuid}-{filename}.
--
-- RLS: SELECT/INSERT/UPDATE/DELETE all gated on ops_users.role='admin'
-- AND is_active=true. Service role bypasses these (used by backend for
-- signed-URL generation + cron purge of soft-deleted files).
--
-- Applied 2026-06-17 via execute_sql MCP.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'medic-documents',
  'medic-documents',
  false,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "medic_documents_select_admin"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'medic-documents'
    AND EXISTS (
      SELECT 1 FROM public.ops_users
      WHERE id = auth.uid() AND is_active = true AND role = 'admin'
    )
  );

CREATE POLICY "medic_documents_insert_admin"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'medic-documents'
    AND EXISTS (
      SELECT 1 FROM public.ops_users
      WHERE id = auth.uid() AND is_active = true AND role = 'admin'
    )
  );

CREATE POLICY "medic_documents_update_admin"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'medic-documents'
    AND EXISTS (
      SELECT 1 FROM public.ops_users
      WHERE id = auth.uid() AND is_active = true AND role = 'admin'
    )
  );

CREATE POLICY "medic_documents_delete_admin"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'medic-documents'
    AND EXISTS (
      SELECT 1 FROM public.ops_users
      WHERE id = auth.uid() AND is_active = true AND role = 'admin'
    )
  );
