-- Lock down the SECURITY DEFINER writer aarogya_register_customer.
--
-- It was created with the Postgres default EXECUTE grant to PUBLIC (→ anon +
-- authenticated), so it was callable via PostgREST with the public anon key and,
-- being SECURITY DEFINER, bypassed RLS — letting anyone forge/poison customers
-- rows and burn next_code('customer'). The only legitimate caller is the Aarogya
-- executor via supabaseAdmin (service_role), so restricting EXECUTE to service_role
-- breaks nothing. Fix-up for PR #102; the creating migration 20260624084548 is
-- already applied and is NOT edited.
--
-- NOTE: next_code(text) carries the same anon/authenticated EXECUTE grant — a
-- pre-existing, broader issue (other code paths may call it). Deliberately NOT
-- touched here; flagged for separate review.
--
-- Applied via MCP (recorded version 20260624183603; filename matches). Verified:
-- proacl is now `postgres, service_role` only.
--
-- Reversibility (restores the prior, less-safe default):
--   GRANT EXECUTE ON FUNCTION public.aarogya_register_customer(
--     uuid, text, text, text, text, text, text, text, date, text) TO PUBLIC;

REVOKE EXECUTE ON FUNCTION public.aarogya_register_customer(
  uuid, text, text, text, text, text, text, text, date, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.aarogya_register_customer(
  uuid, text, text, text, text, text, text, text, date, text
) TO service_role;
