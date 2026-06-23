-- Medic stack RLS hardening — fast-follow to Medic Payroll (#85).
--
-- medics / medic_attendance / medic_ledger_entries were RLS-DISABLED with full
-- anon + authenticated grants (verified) — i.e. the anon key could read PII,
-- attendance/location, and payroll balances, and even write, straight through
-- PostgREST. This enables RLS and clones the doctor policies (M019) verbatim:
--   SELECT        → is_ops_user()    (admin OR agent)
--   INSERT/UPDATE → is_ops_admin()
--   medic_ledger_entries is append-only (SELECT + INSERT only; no UPDATE/DELETE)
--   no DELETE policy anywhere (soft-delete via medics.active; ledger never deleted)
--
-- Grants are left as-is (mirrors doctors): with RLS on and only `TO authenticated`
-- policies, the `anon` role matches no policy → denied. service_role bypasses RLS,
-- and the SECURITY DEFINER accrual triggers (post_medic_earnings_on_*) run as their
-- owner → RLS-exempt, so accrual is unaffected. The ops hub already reads/writes via
-- the authenticated ops session (createOpsRSCClient) or service-role API routes, so
-- NO app changes are required.
--
-- Verified (rolled back, zero residue): anon blocked read+write; an authenticated
-- non-ops principal blocked; ops admin read+write; ops agent read-only; and the
-- accrual trigger still posts a daily_wage under RLS via a service-role attendance
-- insert.
--
-- Applied via Supabase MCP (recorded version 20260623042833); filename equals that
-- version for repo↔DB parity. Timestamp convention per the workspace house rule.
--
-- Reversibility:
--   DROP POLICY IF EXISTS "medic_ledger insertable by ops admins" ON public.medic_ledger_entries;
--   DROP POLICY IF EXISTS "medic_ledger readable by ops" ON public.medic_ledger_entries;
--   DROP POLICY IF EXISTS "medic_attendance updatable by ops admins" ON public.medic_attendance;
--   DROP POLICY IF EXISTS "medic_attendance insertable by ops admins" ON public.medic_attendance;
--   DROP POLICY IF EXISTS "medic_attendance readable by ops" ON public.medic_attendance;
--   DROP POLICY IF EXISTS "medics updatable by ops admins" ON public.medics;
--   DROP POLICY IF EXISTS "medics insertable by ops admins" ON public.medics;
--   DROP POLICY IF EXISTS "medics readable by ops" ON public.medics;
--   ALTER TABLE public.medic_ledger_entries DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.medic_attendance DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.medics DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.medics               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medic_attendance     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medic_ledger_entries ENABLE ROW LEVEL SECURITY;

-- ---- medics ----
DROP POLICY IF EXISTS "medics readable by ops" ON public.medics;
CREATE POLICY "medics readable by ops"
  ON public.medics FOR SELECT TO authenticated
  USING (public.is_ops_user());

DROP POLICY IF EXISTS "medics insertable by ops admins" ON public.medics;
CREATE POLICY "medics insertable by ops admins"
  ON public.medics FOR INSERT TO authenticated
  WITH CHECK (public.is_ops_admin());

DROP POLICY IF EXISTS "medics updatable by ops admins" ON public.medics;
CREATE POLICY "medics updatable by ops admins"
  ON public.medics FOR UPDATE TO authenticated
  USING (public.is_ops_admin()) WITH CHECK (public.is_ops_admin());

-- No DELETE policy on medics — soft-delete via active = false (mirror doctors).

-- ---- medic_attendance ----
DROP POLICY IF EXISTS "medic_attendance readable by ops" ON public.medic_attendance;
CREATE POLICY "medic_attendance readable by ops"
  ON public.medic_attendance FOR SELECT TO authenticated
  USING (public.is_ops_user());

DROP POLICY IF EXISTS "medic_attendance insertable by ops admins" ON public.medic_attendance;
CREATE POLICY "medic_attendance insertable by ops admins"
  ON public.medic_attendance FOR INSERT TO authenticated
  WITH CHECK (public.is_ops_admin());

DROP POLICY IF EXISTS "medic_attendance updatable by ops admins" ON public.medic_attendance;
CREATE POLICY "medic_attendance updatable by ops admins"
  ON public.medic_attendance FOR UPDATE TO authenticated
  USING (public.is_ops_admin()) WITH CHECK (public.is_ops_admin());

-- No DELETE policy: undo attendance via is_present=false (the trigger reverses).

-- ---- medic_ledger_entries (append-only) ----
DROP POLICY IF EXISTS "medic_ledger readable by ops" ON public.medic_ledger_entries;
CREATE POLICY "medic_ledger readable by ops"
  ON public.medic_ledger_entries FOR SELECT TO authenticated
  USING (public.is_ops_user());

DROP POLICY IF EXISTS "medic_ledger insertable by ops admins" ON public.medic_ledger_entries;
CREATE POLICY "medic_ledger insertable by ops admins"
  ON public.medic_ledger_entries FOR INSERT TO authenticated
  WITH CHECK (public.is_ops_admin());

-- No UPDATE/DELETE policies: the ledger is append-only (reverse-and-repost).
-- System earnings/reversals land via the SECURITY DEFINER triggers (RLS-exempt);
-- admin payout/adjustment INSERTs are covered by the policy above.
