// Slice 4a C5 — Patient-scoped tier-2 data accessors.
//
// Pure data layer for the Slice 4a tier-2 tools. The schemas live in
// src/lib/agent/tools.ts; the executors in src/lib/whatsapp/adapter.ts
// (lands in C7) call these helpers. Adapter-injected customerId comes
// from resolveIdentity — the model never supplies scope.
//
// Both helpers return `[]` (not `null`) on absence so downstream tools
// can map cleanly into the canned patient-facing reply.

import { supabaseAdmin } from "@/lib/supabase-server";
import { log } from "@/lib/whatsapp/log";

import { findBookingsByPhone, type BookingRow, type BookingStatus } from "@/lib/agent/bookings";

export type BookingHistoryFilter = "all" | "active" | "completed";

const ACTIVE_STATUSES: BookingStatus[] = [
  "PENDING",
  "PENDING_COLLECTION",
  "CONFIRMED",
  "DISPATCHED",
];

/**
 * All bookings for this patient phone, ordered most-recent-first.
 * `filter` narrows by status. Defaults to 'all'.
 *
 * Implementation reuses findBookingsByPhone (which already does the
 * dirty-phone normalization + filter); here we just re-filter on status.
 */
export async function getBookingHistory(
  phone: string,
  filter: BookingHistoryFilter = "all",
): Promise<BookingRow[]> {
  try {
    // findBookingsByPhone returns latest + latestActive + activeCount but
    // not the full list. For history we need the full list — issue a
    // direct query mirroring findBookingsByPhone's normalization.
    const last10 = (phone ?? "").replace(/\D/g, "").slice(-10);
    if (last10.length < 10) return [];
    const { data, error } = await supabaseAdmin
      .from("bookings")
      .select(
        "id, booking_code, status, service_category, assigned_paramedic, dispatched_at, completed_at, created_at, phone",
      )
      .order("created_at", { ascending: false })
      .limit(300);
    if (error || !data) return [];
    const mine = (data as BookingRow[]).filter(
      (b) => (b.phone ?? "").replace(/\D/g, "").slice(-10) === last10,
    );
    if (filter === "active") {
      return mine.filter((b) => ACTIVE_STATUSES.includes(b.status));
    }
    if (filter === "completed") {
      return mine.filter((b) => b.status === "COMPLETED");
    }
    return mine;
  } catch (err) {
    log.error("getBookingHistory failed", err);
    void findBookingsByPhone; // referenced for type alignment + future inline rewrite
    return [];
  }
}

export interface FamilyMemberRow {
  id: string;
  full_name: string;
  relation: string;
  relation_other: string | null;
  age: number | null;
  created_at: string;
}

/**
 * Family members linked to a customer (M042 family_members). The hard
 * cap is 8 enforced at the DB layer via a BEFORE INSERT trigger; we
 * just SELECT and trust the cap. Returns `[]` on a new visitor (no
 * customerId) or any DB failure.
 *
 * Per CLAUDE.md M042: NO RLS policies; ownership is enforced in API
 * layer via the customerId scope. The adapter is the API layer here.
 */
export async function getFamilyMembers(
  customerId: string | null | undefined,
): Promise<FamilyMemberRow[]> {
  if (!customerId) return [];
  try {
    const { data, error } = await supabaseAdmin
      .from("family_members")
      .select("id, full_name, relation, relation_other, age, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: true });
    if (error || !data) {
      log.error("getFamilyMembers query failed", error?.message);
      return [];
    }
    return data as FamilyMemberRow[];
  } catch (err) {
    log.error("getFamilyMembers threw", err);
    return [];
  }
}
