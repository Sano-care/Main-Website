import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// customer-link-hotpatch — shared helpers for the booking-insert paths.
//
// (1) validatePatientName — rejects empty / whitespace / <2 chars / the
//     literal placeholder "Patient" that leaked from a now-removed client
//     fallback (see SAN-B-00059, 2026-06-08 prod). Both /api/razorpay/verify
//     and /api/lab/create-booking-prepaid call this BEFORE writing
//     bookings.patient_name so the only way the placeholder ends up in the
//     DB is if someone bypasses the API entirely.
//
// (2) lookupCustomerIdByPhone — finds an existing customers row by phone
//     so bookings get their customer_id assigned. SAN-B-00058/00059 both
//     had matching customers (Shashwat / Aayushi) that the booking-insert
//     path was simply not querying. This restores the link.
//
// NOTE: this helper deliberately does NOT auto-create a customers row
// when no match exists — that requires a schema change (drop NOT NULL on
// customers.full_name + customer_code) which lands in T64 PR1's M043,
// not this hot-patch. Until then, phones with no matching customer row
// continue to insert bookings with customer_id = NULL (existing behavior
// — no regression).

const TRIM_LENGTH_MIN = 2;
const TRIM_LENGTH_MAX = 80;
/** Case-insensitive comparison; trimmed input lowercased before check. */
const FORBIDDEN_LOWER = new Set(["patient", "user", "test", "name"]);

export type NameValidation =
  | { ok: true; name: string }
  | { ok: false; error: string };

/**
 * Validate a `patient_name` coming off a booking request body. Returns the
 * trimmed canonical value on success, or a structured error on failure.
 *
 * Why these specific rejections:
 *   - empty / whitespace — would yield an unusable booking row (ops can't
 *     contact a patient by name)
 *   - "Patient" — known leak from a removed client fallback; reject
 *     defensively so any future copy of the old pattern can't reintroduce
 *   - "User" / "Test" / "Name" — common placeholder values from form
 *     defaults / dev testing, reject in the same spirit
 *   - <2 chars — single-letter names are almost always typos
 *   - >80 chars — defensive cap (DB CHECK on customers.full_name was 80
 *     before T64; matches family_members.name CHECK at >=2)
 */
export function validatePatientName(raw: unknown): NameValidation {
  const str = typeof raw === "string" ? raw.trim() : "";
  if (str.length === 0) {
    return { ok: false, error: "Patient name is required." };
  }
  if (str.length < TRIM_LENGTH_MIN) {
    return { ok: false, error: "Patient name must be at least 2 characters." };
  }
  if (str.length > TRIM_LENGTH_MAX) {
    return {
      ok: false,
      error: `Patient name is too long (max ${TRIM_LENGTH_MAX} characters).`,
    };
  }
  if (FORBIDDEN_LOWER.has(str.toLowerCase())) {
    return {
      ok: false,
      error: "Please enter the patient's actual name (not a placeholder).",
    };
  }
  return { ok: true, name: str };
}

/**
 * Look up an existing `customers.id` for a phone number. Returns null when
 * no row exists (the caller writes customer_id = NULL to bookings — same
 * as today's behavior). Pass the full E.164 phone exactly as it lives on
 * the bookings row (e.g. "+919711977782").
 *
 * Uses .maybeSingle() so "no row found" isn't an error — that's a normal
 * case for booking-only patients who haven't been ops-created yet.
 *
 * Soft-fail on query errors: logs + returns null so a transient DB blip
 * doesn't break the booking insert. Better to have an orphan booking
 * (recoverable via backfill) than to refuse a paid booking.
 */
export async function lookupCustomerIdByPhone(
  supabase: SupabaseClient,
  phone: string,
): Promise<string | null> {
  if (!phone || typeof phone !== "string") return null;
  const trimmed = phone.trim();
  if (trimmed.length === 0) return null;

  const { data, error } = await supabase
    .from("customers")
    .select("id")
    .eq("phone", trimmed)
    .maybeSingle();

  if (error) {
    console.error("[customerLink] phone lookup failed:", error);
    return null;
  }
  return (data?.id as string | undefined) ?? null;
}
