// Booking + complaint data access for the Aarogya tools (Slice 1).
// Channel-agnostic (no WhatsApp specifics) so future adapters reuse it.
//
// bookings.phone is dirty in prod (mix of +91…, 91…, spaces/dashes), so all
// matching is on the LAST 10 DIGITS. service_category is also dirty
// (homecare / home-visit / "Home visit" / nursing / chronic / diagnostics /
// lab / lab-tests / teleconsult) → fuzzy-mapped to the tool service enum.

import { supabaseAdmin } from "@/lib/supabase-server";

export type ToolService = "home_visit" | "home_nursing" | "lab" | "teleconsult";

export type BookingStatus =
  | "PENDING"
  | "PENDING_COLLECTION"
  | "CONFIRMED"
  | "DISPATCHED"
  | "COMPLETED"
  | "CANCELLED";

const ACTIVE_STATUSES: BookingStatus[] = [
  "PENDING",
  "PENDING_COLLECTION",
  "CONFIRMED",
  "DISPATCHED",
];

export interface BookingRow {
  id: string;
  booking_code: string | null;
  status: BookingStatus;
  service_category: string | null;
  assigned_paramedic: string | null;
  dispatched_at: string | null;
  completed_at: string | null;
  created_at: string;
  phone: string;
}

/** Last 10 digits — robust across +91 / 91 / spaces / dashes / formatting. */
export function normalizePhoneLast10(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "").slice(-10);
}

/** Dirty service_category → the tool's service enum. */
export function mapServiceCategory(raw: string | null | undefined): ToolService {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("tele")) return "teleconsult";
  if (s.includes("lab") || s.includes("diagn")) return "lab";
  if (s.includes("nurs")) return "home_nursing";
  return "home_visit"; // homecare / home-visit / chronic / default
}

export interface BookingLookup {
  latest: BookingRow | null; // most recent booking of any status
  latestActive: BookingRow | null; // most recent PENDING/CONFIRMED/DISPATCHED
  activeCount: number;
}

/**
 * Find the patient's bookings by phone (last-10 match). Returns the most-recent
 * booking, the most-recent ACTIVE one, and the active count (for disambiguation
 * when several are in flight). Fetch is bounded by recency — fine at current
 * scale; a normalized-phone column or DB function is the optimization later.
 */
export async function findBookingsByPhone(phone: string): Promise<BookingLookup> {
  const last10 = normalizePhoneLast10(phone);
  if (last10.length < 10) return { latest: null, latestActive: null, activeCount: 0 };

  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select("id, booking_code, status, service_category, assigned_paramedic, dispatched_at, completed_at, created_at, phone")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error || !data) return { latest: null, latestActive: null, activeCount: 0 };

  const mine = (data as BookingRow[]).filter(
    (b) => normalizePhoneLast10(b.phone) === last10,
  );
  const active = mine.filter((b) => ACTIVE_STATUSES.includes(b.status));
  return {
    latest: mine[0] ?? null,
    latestActive: active[0] ?? null,
    activeCount: active.length,
  };
}

/**
 * Cancel a booking — matches the ops server action's write exactly
 * (status + cancellation_reason + cancelled_at) to keep one source of truth.
 * (A shared BookingService.cancelBooking(id, reason) would DRY this up later.)
 */
export async function cancelBookingById(id: string, reason: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("bookings")
    .update({
      status: "CANCELLED",
      cancellation_reason: reason,
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", id);
  return !error;
}

export interface ComplaintInput {
  phone: string; // normalised (last-10 ok; stored as-given)
  bookingId: string | null;
  category: string;
  narrative: string;
  severity: "low" | "medium" | "high" | "critical";
}

/** Insert a complaint row. Returns the new id, or null on failure. */
export async function insertComplaint(c: ComplaintInput): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("complaints")
    .insert({
      phone: c.phone,
      booking_id: c.bookingId,
      category: c.category,
      narrative: c.narrative,
      severity: c.severity,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return data.id;
}
