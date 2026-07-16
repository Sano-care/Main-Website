-- Pulse Android PB1 — opaque bearer session tokens for the native patient app.
--
-- The web patient session is a stateless HMAC-signed cookie (src/lib/otp/token.ts)
-- with no server-side row, so it can't be revoked. The native app needs an
-- indefinite, server-revocable credential — this table backs that.
--
-- Model (founder-approved 2026-07-16):
--   * Opaque 256-bit random token, minted on /api/auth/verify-otp success ONLY
--     when the request carries `X-Sanocare-Client: android-pulse` (additive; the
--     web cookie path is untouched).
--   * Stored SHA-256 hashed (a 256-bit random token needs no slow KDF); the raw
--     token is returned once to the client and never persisted server-side.
--   * Bound to customer_id (stable across a phone change; phone is unique in
--     customers so the binding is unambiguous).
--   * Indefinite + revoke-only: no exp column. Sign-out sets revoked_at.
--   * device_label captured now (nullable) so "manage devices / sign out
--     everywhere" ships later without another migration.
--   * last_seen_at throttled by the resolver (written at most once/hour), not on
--     every request.
--
-- Access: ONLY the service-role client (verify-otp mint, requirePulseCustomer
-- resolve, /api/pulse/signout revoke). RLS is enabled deny-all (no policies) —
-- service_role bypasses RLS; anon/authenticated get nothing. Same posture as the
-- Pulse health tables. DPDP: the raw token is a credential — never logged; only
-- the hash lives here; India-region (ap-south-1).

CREATE TABLE public.mobile_session_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  device_label text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);

-- Supports the future "list / revoke this customer's devices" surface.
CREATE INDEX idx_mobile_session_tokens_customer
  ON public.mobile_session_tokens (customer_id);

-- Deny-all RLS: no policies. Only the service-role client touches this table.
ALTER TABLE public.mobile_session_tokens ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.mobile_session_tokens IS
  'Opaque bearer session tokens for the native Pulse app (PB1). token_hash = sha256(raw base64url token); bound to customer_id; indefinite, revoke-only via revoked_at. Service-role only (deny-all RLS).';
