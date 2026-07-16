import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase-server";

// Opaque bearer session tokens for the native Pulse app (PB1).
//
// The web patient session is a stateless HMAC-signed cookie (see ./token.ts) —
// no server row, not revocable. The native app instead uses an opaque 256-bit
// random bearer token, stored SHA-256-hashed in `mobile_session_tokens`, bound
// to a customer_id, indefinite and revoke-only. This module is the ONLY place
// that reads/writes that table; it runs exclusively under the service-role
// client (the table is RLS deny-all).
//
// DPDP: the raw token is a credential — never log it. Only its hash is stored.
// The raw value is returned to the client exactly once (at verify-otp) and lives
// thereafter only in the device's EncryptedSharedPreferences.

/** Header the native app sends so verify-otp knows to also mint a bearer token. */
export const MOBILE_CLIENT_HEADER = "x-sanocare-client";
export const MOBILE_CLIENT_VALUE = "android-pulse";

/** last_seen_at is refreshed at most once per hour per token (not every call). */
const LAST_SEEN_THROTTLE_MS = 60 * 60 * 1000;

interface HeaderReader {
  headers: { get(name: string): string | null };
}

/** True when the request identifies as the native Pulse app. */
export function isMobilePulseClient(req: HeaderReader): boolean {
  return (
    req.headers.get(MOBILE_CLIENT_HEADER)?.trim().toLowerCase() ===
    MOBILE_CLIENT_VALUE
  );
}

/** Extract the raw token from an `Authorization: Bearer <token>` header. */
export function bearerFromAuthHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Mint + persist a new mobile session token for `customerId`. Returns the RAW
 * opaque token (to hand to the client once), or null if the insert failed.
 */
export async function mintMobileSessionToken(args: {
  customerId: string;
  deviceLabel?: string | null;
}): Promise<string | null> {
  const raw = randomBytes(32).toString("base64url"); // 256-bit, opaque
  const token_hash = hashToken(raw);
  const deviceLabel =
    typeof args.deviceLabel === "string" && args.deviceLabel.trim().length > 0
      ? args.deviceLabel.trim().slice(0, 120)
      : null;
  const { error } = await supabaseAdmin.from("mobile_session_tokens").insert({
    customer_id: args.customerId,
    token_hash,
    device_label: deviceLabel,
  });
  if (error) {
    console.error("[mobileToken] mint insert failed:", error);
    return null;
  }
  return raw;
}

/**
 * Resolve a raw bearer token to its `customer_id`, or null when the token is
 * unknown or revoked. Refreshes `last_seen_at` at most once per hour (best-effort).
 */
export async function resolveMobileSessionCustomerId(rawToken: string): Promise<string | null> {
  if (!rawToken) return null;
  const token_hash = hashToken(rawToken);
  const { data, error } = await supabaseAdmin
    .from("mobile_session_tokens")
    .select("id, customer_id, last_seen_at")
    .eq("token_hash", token_hash)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) {
    console.error("[mobileToken] resolve lookup failed:", error);
    return null;
  }
  if (!data) return null;

  const lastSeen = data.last_seen_at ? Date.parse(data.last_seen_at as string) : 0;
  if (Number.isNaN(lastSeen) || Date.now() - lastSeen > LAST_SEEN_THROTTLE_MS) {
    // Throttled touch — ignore failure (a stale last_seen_at is harmless).
    const { error: touchErr } = await supabaseAdmin
      .from("mobile_session_tokens")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", data.id as string);
    if (touchErr) console.error("[mobileToken] last_seen touch failed:", touchErr);
  }

  return data.customer_id as string;
}

/**
 * Revoke a mobile token (sign-out). Sets `revoked_at` on the matching, not-yet-
 * revoked row. Best-effort; returns true when a row was revoked.
 */
export async function revokeMobileSessionToken(rawToken: string): Promise<boolean> {
  if (!rawToken) return false;
  const token_hash = hashToken(rawToken);
  const { data, error } = await supabaseAdmin
    .from("mobile_session_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", token_hash)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[mobileToken] revoke failed:", error);
    return false;
  }
  return !!data;
}
