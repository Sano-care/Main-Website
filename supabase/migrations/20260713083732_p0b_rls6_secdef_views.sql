-- P0b — close the remaining leakage-proof ERRORs from the Supabase security
-- advisor (post-#129): 6 public tables with RLS off + 2 SECURITY DEFINER views.
-- SQL-only; no code change.
--
-- Per-table caller recon (grep of every reader/writer) decided each posture:
--   * consent_ledger      — only writer: /api/consent/record (supabaseAdmin)
--   * callback_requests   — only writer: /api/callback-request (supabaseAdmin);
--                           the public site form posts to that server route, NOT
--                           a direct anon insert → deny-all, no public policy.
--   * medic_event_log     — only /api/medic-app/{duty,event} (createServiceClient)
--   * no_show_escalation_queue — only /api/medic-app/event (createServiceClient)
--   -> all four are service-role only → ENABLE RLS deny-all (service_role bypasses
--      RLS; anon/authenticated get nothing). Same posture as the Pulse tables.
--
--   * medic_payout_settlements — read by /ops/medics/[id]/page.tsx via
--     createOpsRSCClient (the AUTHENTICATED ops role); written by
--     settle_medic_payout() (SECURITY DEFINER → bypasses RLS).
--   * medic_location_pings — written by /api/medic-app/location (service-role);
--     read by ops routes (supabaseAdmin) AND /ops/medics/[id]/page.tsx
--     (authenticated ops).
--   -> both have an authenticated ops READER → ENABLE RLS + a SELECT policy that
--      matches the house "readable by ops" convention on medics/doctors/customers
--      (FOR SELECT TO authenticated USING (is_ops_user())). is_ops_user() (not
--      is_ops_admin()) is deliberate: the same page reads `medics` under an
--      is_ops_user() SELECT policy, so a stricter admin gate here would break
--      non-admin ops viewers. Service-role writers bypass RLS, so no write policy
--      is needed.
--
-- spatial_ref_sys (the 7th rls_disabled row) is a PostGIS system table — accepted,
-- left as-is.

-- ===========================================================================
-- Part A — enable RLS on the 6 exposed tables
-- ===========================================================================

-- ---- Deny-all: service-role-only callers ----
ALTER TABLE public.consent_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.callback_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medic_event_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.no_show_escalation_queue ENABLE ROW LEVEL SECURITY;

-- ---- Ops-readable: RLS + is_ops_user() SELECT policy (authenticated ops RSC) ----
ALTER TABLE public.medic_payout_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "medic_payout_settlements readable by ops"
  ON public.medic_payout_settlements
  FOR SELECT
  TO authenticated
  USING (is_ops_user());

ALTER TABLE public.medic_location_pings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "medic_location_pings readable by ops"
  ON public.medic_location_pings
  FOR SELECT
  TO authenticated
  USING (is_ops_user());

-- ===========================================================================
-- Part B — switch the 2 SECURITY DEFINER views to SECURITY INVOKER
-- ===========================================================================
-- Verified safe against the querying-role change:
--   * vw_patient_session_log — sole reader is /ops/(shell)/sessions/page.tsx
--     (authenticated ops, is_ops_user). Its base tables (bookings, customers,
--     consultation_sessions, consultation_participants, doctors) ALL already have
--     is_ops_user() SELECT policies, so the ops read keeps returning every row.
--   * cms_view_media_tree — no application caller; base table cms_media_assets
--     has a public SELECT policy (deleted_at IS NULL), and any service-role
--     reader bypasses RLS regardless.
ALTER VIEW public.vw_patient_session_log SET (security_invoker = true);
ALTER VIEW public.cms_view_media_tree SET (security_invoker = true);
