-- P0 — lock the anon-executable SECURITY DEFINER RPCs (2026-06-25 review).
--
-- These SECURITY DEFINER financial/ops functions were EXECUTE-granted to `anon`
-- (+ `authenticated`, PUBLIC), so any publishable-key holder could call them via
-- PostgREST. This revokes EXECUTE from anon/authenticated/PUBLIC; `service_role`
-- retains EXECUTE. Every app caller uses the service-role client
-- (supabaseAdmin / createServiceClient) — verified by call-site grep — so this
-- is invisible to the app. Mirrors the already-locked aarogya_register_customer.
--
-- Signatures verified against pg_proc identity args on the live DB; each
-- function has exactly one overload.
--
-- The explicit GRANT ... TO service_role after each REVOKE is a safety net: it
-- guarantees service_role keeps EXECUTE even in the (unexpected) case where its
-- only prior grant had come via PUBLIC. No privilege is expanded — service_role
-- already had EXECUTE.
--
-- EXCEPTION — next_code(p_type text): the ops server actions (bookings /
-- doctors / partners / patients creation) call it through createOpsRSCClient,
-- which is the anon key + the ops user's Supabase Auth JWT → the `authenticated`
-- role, NOT service_role. So next_code keeps `authenticated`; only anon + PUBLIC
-- are revoked (closing the publishable-key hole). FOLLOW-UP (server-side, not in
-- this SQL-only PR): migrate those four ops actions to the service-role client,
-- then revoke `authenticated` from next_code too for full defense-in-depth.

-- ===========================================================================
-- Group A — fully locked (service_role only): revoke anon, authenticated, PUBLIC
-- ===========================================================================

-- ---- Invocable financial / ops RPCs (all callers: supabaseAdmin / createServiceClient) ----

REVOKE EXECUTE ON FUNCTION public.settle_medic_payout(p_medic_id uuid, p_amount_paise bigint, p_reference_text character varying, p_payout_method text, p_notes text, p_file_path text, p_file_size_bytes integer, p_mime_type text, p_ops_user_id uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_medic_payout(p_medic_id uuid, p_amount_paise bigint, p_reference_text character varying, p_payout_method text, p_notes text, p_file_path text, p_file_size_bytes integer, p_mime_type text, p_ops_user_id uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.post_gda_shift_earning(p_shift_id uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_gda_shift_earning(p_shift_id uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.reverse_gda_shift_earning(p_shift_id uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_gda_shift_earning(p_shift_id uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.record_doctor_presence(p_doctor_id uuid, p_presence_date date) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_doctor_presence(p_doctor_id uuid, p_presence_date date) TO service_role;

REVOKE EXECUTE ON FUNCTION public.purge_old_otp_verifications() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_old_otp_verifications() TO service_role;

-- ---- Trigger-invoked functions (fire via triggers regardless of EXECUTE grant) ----

REVOKE EXECUTE ON FUNCTION public.assign_booking_code() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_booking_code() TO service_role;

REVOKE EXECUTE ON FUNCTION public.cms_log_change() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.cms_log_change() TO service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

REVOKE EXECUTE ON FUNCTION public.mark_attendance_on_presence() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_attendance_on_presence() TO service_role;

REVOKE EXECUTE ON FUNCTION public.post_doctor_earnings_on_attendance() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_doctor_earnings_on_attendance() TO service_role;

REVOKE EXECUTE ON FUNCTION public.post_doctor_earnings_on_booking() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_doctor_earnings_on_booking() TO service_role;

REVOKE EXECUTE ON FUNCTION public.post_medic_earnings_on_attendance() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_medic_earnings_on_attendance() TO service_role;

REVOKE EXECUTE ON FUNCTION public.post_medic_earnings_on_booking() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_medic_earnings_on_booking() TO service_role;

-- ===========================================================================
-- Group B — keep authenticated (ops next_code): revoke anon + PUBLIC only
-- ===========================================================================

REVOKE EXECUTE ON FUNCTION public.next_code(p_type text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_code(p_type text) TO authenticated, service_role;
