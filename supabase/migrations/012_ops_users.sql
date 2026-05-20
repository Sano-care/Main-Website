-- Migration 012 — Ops users (internal admin/agent directory)
--
-- Creates the membership table that gates the /ops admin dashboard. A row in
-- `ops_users` is the source of truth for "this auth.users id is part of the
-- internal operations team." Membership in this table is checked by:
--   * server-side middleware (src/middleware.ts) before serving any /ops page
--   * RLS policies on ops data (via the is_ops_user() helper below)
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.ops_users (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  email       text NOT NULL,
  role        text NOT NULL CHECK (role IN ('admin', 'agent')),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_users_email ON public.ops_users (lower(email));
CREATE INDEX IF NOT EXISTS idx_ops_users_active ON public.ops_users (is_active) WHERE is_active = true;

COMMENT ON TABLE public.ops_users IS
  'Internal operations team directory. A row here grants access to /ops/* via middleware + RLS. Master-managed: create rows manually in Supabase Studio after creating the matching auth.users entry.';

-- ===== Helper: is_ops_user() =====
-- Returns true iff the current authenticated user is an active row in ops_users.
-- SECURITY DEFINER so the function can read ops_users regardless of the caller's
-- own RLS visibility. Marked STABLE so PostgREST/RLS can cache it within a tx.
CREATE OR REPLACE FUNCTION public.is_ops_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.ops_users
    WHERE id = auth.uid()
      AND is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_ops_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_ops_user() TO authenticated;

COMMENT ON FUNCTION public.is_ops_user() IS
  'True iff auth.uid() is an active ops_users row. Use in RLS policies that gate ops-only reads/writes.';

-- ===== RLS on ops_users itself =====
ALTER TABLE public.ops_users ENABLE ROW LEVEL SECURITY;

-- Read policy: only active ops users can see the directory.
DROP POLICY IF EXISTS "ops_users readable by ops" ON public.ops_users;
CREATE POLICY "ops_users readable by ops"
  ON public.ops_users
  FOR SELECT
  TO authenticated
  USING (public.is_ops_user());

-- No INSERT/UPDATE/DELETE policies: those are done by the master via
-- Supabase Studio (service-role bypasses RLS). Add policies later when an
-- in-app admin management UI ships.
