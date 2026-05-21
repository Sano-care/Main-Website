"use server";

import { revalidatePath } from "next/cache";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { getCurrentOpsUser } from "../../_lib/getCurrentOpsUser";
import { isBookingStatus, type BookingStatus } from "../../_lib/bookingStatus";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getString(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

function getRequired(formData: FormData, key: string): string {
  const v = getString(formData, key);
  if (!v) throw new Error(`${key} is required`);
  return v;
}

function revalidateBooking(id: string) {
  revalidatePath("/ops/bookings");
  revalidatePath(`/ops/bookings/${id}`);
}

/**
 * Change booking status. Stamps assigned_at / completed_at on first
 * transition to DISPATCHED / COMPLETED|REPORT_DELIVERED. Use cancelBooking()
 * to set CANCELLED — it requires a reason.
 */
export async function changeStatus(formData: FormData) {
  await getCurrentOpsUser();
  const bookingId = getRequired(formData, "booking_id");
  const newStatus = getRequired(formData, "status");

  if (!isBookingStatus(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}`);
  }
  if (newStatus === "CANCELLED") {
    throw new Error("Use the Cancel action to set CANCELLED — it requires a reason.");
  }

  const supabase = await createOpsRSCClient();

  // Read current row to decide whether to stamp assigned_at (one-shot).
  const { data: current, error: readErr } = await supabase
    .from("bookings")
    .select("status, assigned_at")
    .eq("id", bookingId)
    .maybeSingle();
  if (readErr || !current) {
    throw new Error(`Could not read booking: ${readErr?.message ?? "not found"}`);
  }

  const update: Record<string, unknown> = { status: newStatus };
  const nowIso = new Date().toISOString();

  if (newStatus === "DISPATCHED" && !current.assigned_at) {
    update.assigned_at = nowIso;
  }
  if (newStatus === "COMPLETED" || newStatus === "REPORT_DELIVERED") {
    update.completed_at = nowIso;
  }

  const { error } = await supabase
    .from("bookings")
    .update(update)
    .eq("id", bookingId);
  if (error) {
    throw new Error(`Could not update status: ${error.message}`);
  }

  revalidateBooking(bookingId);
}

/**
 * Set or change the scheduled appointment time.
 * Empty value clears it.
 */
export async function reschedule(formData: FormData) {
  await getCurrentOpsUser();
  const bookingId = getRequired(formData, "booking_id");
  const raw = getString(formData, "scheduled_for");

  let scheduled_for: string | null = null;
  if (raw) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
      throw new Error("Invalid scheduled time");
    }
    scheduled_for = d.toISOString();
  }

  const supabase = await createOpsRSCClient();
  const { error } = await supabase
    .from("bookings")
    .update({ scheduled_for })
    .eq("id", bookingId);
  if (error) throw new Error(`Could not reschedule: ${error.message}`);

  revalidateBooking(bookingId);
}

/**
 * Cancel the booking. Sets status=CANCELLED, records the reason, and
 * stamps cancelled_at.
 */
export async function cancelBooking(formData: FormData) {
  await getCurrentOpsUser();
  const bookingId = getRequired(formData, "booking_id");
  const reason = getRequired(formData, "cancellation_reason");

  const supabase = await createOpsRSCClient();
  const { error } = await supabase
    .from("bookings")
    .update({
      status: "CANCELLED" satisfies BookingStatus,
      cancellation_reason: reason,
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", bookingId);
  if (error) throw new Error(`Could not cancel: ${error.message}`);

  revalidateBooking(bookingId);
}

/**
 * Add or replace the ops-only notes on a booking. Patient-facing `notes`
 * is never touched.
 */
export async function saveOpsNotes(formData: FormData) {
  await getCurrentOpsUser();
  const bookingId = getRequired(formData, "booking_id");
  const ops_notes = getString(formData, "ops_notes"); // null clears it

  const supabase = await createOpsRSCClient();
  const { error } = await supabase
    .from("bookings")
    .update({ ops_notes })
    .eq("id", bookingId);
  if (error) throw new Error(`Could not save notes: ${error.message}`);

  revalidateBooking(bookingId);
}

/**
 * Link this booking to a customer. Accepts either a SAN-C-… code or a
 * full UUID. Empty value unlinks (customer_id → null).
 */
export async function linkCustomer(formData: FormData) {
  await getCurrentOpsUser();
  const bookingId = getRequired(formData, "booking_id");
  const target = getString(formData, "target"); // null = unlink

  const supabase = await createOpsRSCClient();
  let customer_id: string | null = null;

  if (target) {
    if (UUID_RE.test(target)) {
      const { data } = await supabase
        .from("customers")
        .select("id")
        .eq("id", target)
        .maybeSingle();
      if (!data) throw new Error(`No customer with id ${target}`);
      customer_id = data.id;
    } else {
      const { data } = await supabase
        .from("customers")
        .select("id")
        .eq("customer_code", target.toUpperCase())
        .maybeSingle();
      if (!data) {
        throw new Error(`No customer with code ${target.toUpperCase()}`);
      }
      customer_id = data.id;
    }
  }

  const { error } = await supabase
    .from("bookings")
    .update({ customer_id })
    .eq("id", bookingId);
  if (error) throw new Error(`Could not link customer: ${error.message}`);

  revalidateBooking(bookingId);
}

/**
 * Link this booking to a partner. Accepts either a SAN-P-… code or a
 * full UUID. Empty value unlinks (partner_id → null).
 */
export async function linkPartner(formData: FormData) {
  await getCurrentOpsUser();
  const bookingId = getRequired(formData, "booking_id");
  const target = getString(formData, "target");

  const supabase = await createOpsRSCClient();
  let partner_id: string | null = null;

  if (target) {
    if (UUID_RE.test(target)) {
      const { data } = await supabase
        .from("partners")
        .select("id")
        .eq("id", target)
        .maybeSingle();
      if (!data) throw new Error(`No partner with id ${target}`);
      partner_id = data.id;
    } else {
      const { data } = await supabase
        .from("partners")
        .select("id")
        .eq("partner_code", target.toUpperCase())
        .maybeSingle();
      if (!data) {
        throw new Error(`No partner with code ${target.toUpperCase()}`);
      }
      partner_id = data.id;
    }
  }

  const { error } = await supabase
    .from("bookings")
    .update({ partner_id })
    .eq("id", bookingId);
  if (error) throw new Error(`Could not link partner: ${error.message}`);

  revalidateBooking(bookingId);
}
