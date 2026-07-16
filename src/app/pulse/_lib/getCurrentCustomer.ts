import "server-only";

import { cookies } from "next/headers";

import { supabaseAdmin } from "@/lib/supabase-server";
import { VERIFY_COOKIE_NAME, verifyToken } from "@/lib/otp/token";

// Server-side identity resolution for the Sanocare Pulse surface.
//
// Pulse reuses the EXISTING patient OTP session — there is no parallel auth
// stack. The `sanocare_otp_verify` HttpOnly cookie (VERIFY_COOKIE_NAME) is
// minted by /api/auth/verify-otp on OTP success; here we decode it via the
// shared `verifyToken`, read the verified phone, and resolve it to a row in
// `public.customers` (the live schema keys Pulse data on `customer_id →
// customers`, NOT a `patients` table).
//
// T64 will introduce getCurrentAccountMembers() returning the array of
// customers managed by this signed-in identity (one phone may manage a
// spouse / parent / child). getCurrentCustomer() stays a thin wrapper
// returning the primary — the member-switching UI layers on top without
// changing this contract.

export interface PulseCustomer {
  id: string;
  full_name: string | null;
  phone: string;
}

/**
 * Resolve a verified-phone token string to its `customers` row. Shared by
 * the server-component helper (below) and the API-route guard
 * (`requirePulseCustomer`). Returns null when the token is missing /
 * invalid / expired, or when no customer exists for the verified phone
 * (the caller decides whether that means "redirect to login" or "prompt
 * for name capture").
 */
export async function resolveCustomerFromToken(
  token: string | undefined | null,
): Promise<PulseCustomer | null> {
  const verified = verifyToken(token);
  if (!verified) return null;

  const { data, error } = await supabaseAdmin
    .from("customers")
    .select("id, full_name, phone")
    .eq("phone", verified.phone)
    .maybeSingle();

  if (error) {
    console.error("[pulse/getCurrentCustomer] customer lookup failed:", error);
    return null;
  }
  if (!data?.id) return null;

  return {
    id: data.id as string,
    full_name: (data.full_name as string | null) ?? null,
    phone: (data.phone as string) ?? verified.phone,
  };
}

/**
 * Resolve a `customers.id` directly to its row. Used by the native-app bearer
 * path (mobile_session_tokens binds to customer_id, not phone), parallel to
 * resolveCustomerFromToken's phone-based lookup for the web cookie. Returns null
 * when the id has no row.
 */
export async function resolveCustomerById(
  customerId: string,
): Promise<PulseCustomer | null> {
  const { data, error } = await supabaseAdmin
    .from("customers")
    .select("id, full_name, phone")
    .eq("id", customerId)
    .maybeSingle();

  if (error) {
    console.error("[pulse/getCurrentCustomer] customer-by-id lookup failed:", error);
    return null;
  }
  if (!data?.id) return null;

  return {
    id: data.id as string,
    full_name: (data.full_name as string | null) ?? null,
    phone: (data.phone as string) ?? "",
  };
}

/**
 * The signed-in Pulse customer for the current server-component render, or
 * null if the visitor is unauthenticated / has no customer row yet.
 *
 * Reads cookies via next/headers, so this is callable from server
 * components and route handlers but NOT from the edge middleware. The
 * (authed) route-group layout calls this and redirects to /pulse/login
 * on null.
 *
 * T64 note (see file header): getCurrentAccountMembers() will return the
 * full managed-customer array; this stays the primary-only wrapper.
 */
export async function getCurrentCustomer(): Promise<PulseCustomer | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(VERIFY_COOKIE_NAME)?.value;
  return resolveCustomerFromToken(token);
}
