-- PREREQUISITE to GDA onboarding (which stores Aadhaar/PAN images): RLS-harden the
-- document tables, mirroring the #87 doctor/medic pattern. Before this,
-- medic_documents + medic_doc_access_log were RLS-DISABLED with full anon grants
-- (PII readable via the anon key). Service-role (the docs upload + signed-URL
-- routes) bypasses RLS, so those keep working; the ops hub reads via the
-- authenticated session (is_ops_user).
--
--   SELECT → is_ops_user()   (admin OR agent)
--   medic_documents INSERT/UPDATE → is_ops_admin()   (no DELETE policy)
--   medic_doc_access_log is append-only audit, written ONLY by the service-role
--     signed-URL route → SELECT-only policy (no INSERT/UPDATE/DELETE for authenticated).
--
-- Grants left as-is (mirrors #87): anon matches no policy → denied.
-- Applied via MCP (recorded version 20260624063134; filename matches).
--
-- Reversibility:
--   DROP POLICY IF EXISTS "medic_doc_access_log readable by ops" ON public.medic_doc_access_log;
--   DROP POLICY IF EXISTS "medic_documents updatable by ops admins" ON public.medic_documents;
--   DROP POLICY IF EXISTS "medic_documents insertable by ops admins" ON public.medic_documents;
--   DROP POLICY IF EXISTS "medic_documents readable by ops" ON public.medic_documents;
--   ALTER TABLE public.medic_doc_access_log DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.medic_documents DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.medic_documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medic_doc_access_log ENABLE ROW LEVEL SECURITY;

-- ---- medic_documents ----
DROP POLICY IF EXISTS "medic_documents readable by ops" ON public.medic_documents;
CREATE POLICY "medic_documents readable by ops"
  ON public.medic_documents FOR SELECT TO authenticated
  USING (public.is_ops_user());

DROP POLICY IF EXISTS "medic_documents insertable by ops admins" ON public.medic_documents;
CREATE POLICY "medic_documents insertable by ops admins"
  ON public.medic_documents FOR INSERT TO authenticated
  WITH CHECK (public.is_ops_admin());

DROP POLICY IF EXISTS "medic_documents updatable by ops admins" ON public.medic_documents;
CREATE POLICY "medic_documents updatable by ops admins"
  ON public.medic_documents FOR UPDATE TO authenticated
  USING (public.is_ops_admin()) WITH CHECK (public.is_ops_admin());
-- No DELETE policy — soft-delete via deleted_at (UPDATE); hard purge via service-role.

-- ---- medic_doc_access_log (append-only audit) ----
DROP POLICY IF EXISTS "medic_doc_access_log readable by ops" ON public.medic_doc_access_log;
CREATE POLICY "medic_doc_access_log readable by ops"
  ON public.medic_doc_access_log FOR SELECT TO authenticated
  USING (public.is_ops_user());
-- No INSERT/UPDATE/DELETE policy: only the service-role signed-URL route writes it.
