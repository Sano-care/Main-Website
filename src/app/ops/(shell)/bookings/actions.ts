"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { getCurrentOpsUser } from "../../_lib/getCurrentOpsUser";
import {
  isBookingStatus,
  SERVICE_CATEGORIES,
  type BookingStatus,
} from "../../_lib/bookingStatus";

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

/**
 * Create a booking on behalf of a patient (the "ops logs a WhatsApp
 * booking" flow). Two customer modes:
 *
 *   - "existing": look the customer up by SAN-C code, phone, or full UUID
 *   - "new":      create the customer inline (next_code('customer') + insert)
 *
 * Always populates the legacy `patient_name` and `phone` columns on the
 * booking row from the resolved customer, so the existing /ops/lab view +
 * any other downstream code that reads those columns keeps working.
 * `booking_code` is left NULL — the trg_bookings_assign_code trigger from
 * migration 015 stamps it via next_code('booking') on INSERT.
 */
export async function createBooking(formData: FormData) {
  const opsUser = await getCurrentOpsUser();

  // ---- Validate booking-level fields first, before any writes ----
  const mode = formData.get("customer_mode");
  if (mode !== "existing" && mode !== "new") {
    throw new Error("Invalid customer mode");
  }

  const service_category = getRequired(formData, "service_category");
  if (!(SERVICE_CATEGORIES as readonly string[]).includes(service_category)) {
    throw new Error(`Invalid service: ${service_category}`);
  }
  const manual_address = getRequired(formData, "manual_address");

  const scheduled_for_raw = getString(formData, "scheduled_for");
  let scheduled_for: string | null = null;
  if (scheduled_for_raw) {
    const d = new Date(scheduled_for_raw);
    if (Number.isNaN(d.getTime())) {
      throw new Error("Invalid scheduled time");
    }
    scheduled_for = d.toISOString();
  }

  const amount_raw = getString(formData, "amount");
  let amount: number | null = null;
  if (amount_raw) {
    const n = Number(amount_raw);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error("Amount must be a non-negative number");
    }
    amount = Math.round(n);
  }

  const supabase = await createOpsRSCClient();

  // ---- Resolve customer (existing) or create (new) ----
  let customerId: string;
  let customerName: string;
  let customerPhone: string;

  if (mode === "existing") {
    const lookup = getRequired(formData, "customer_lookup");
    type LookupRow = { id: string; full_name: string; phone: string | null };
    let row: LookupRow | null = null;

    if (UUID_RE.test(lookup)) {
      const { data } = await supabase
        .from("customers")
        .select("id, full_name, phone")
        .eq("id", lookup)
        .maybeSingle();
      row = (data as LookupRow | null) ?? null;
    } else if (lookup.toUpperCase().startsWith("SAN-C-")) {
      const { data } = await supabase
        .from("customers")
        .select("id, full_name, phone")
        .eq("customer_code", lookup.toUpperCase())
        .maybeSingle();
      row = (data as LookupRow | null) ?? null;
    } else {
      // Treat as phone — exact match (avoid partial/ilike to keep it predictable)
      const { data } = await supabase
        .from("customers")
        .select("id, full_name, phone")
        .eq("phone", lookup)
        .limit(1)
        .maybeSingle();
      row = (data as LookupRow | null) ?? null;
    }

    if (!row) {
      throw new Error(`No customer found for "${lookup}"`);
    }
    if (!row.phone) {
      throw new Error(
        `Customer ${row.full_name} has no phone on file — add one via /ops/patients first.`,
      );
    }
    customerId = row.id;
    customerName = row.full_name;
    customerPhone = row.phone;
  } else {
    // mode === "new": create the customer inline using the same path as M1
    const full_name = getRequired(formData, "customer_full_name");
    const phone = getRequired(formData, "customer_phone");

    const { data: code, error: codeErr } = await supabase.rpc("next_code", {
      p_type: "customer",
    });
    if (codeErr || !code) {
      throw new Error(`Could not allocate customer code: ${codeErr?.message ?? "unknown"}`);
    }

    type NewCustomerRow = { id: string; full_name: string; phone: string | null };
    const { data: created, error: insertErr } = await supabase
      .from("customers")
      .insert({
        customer_code: code,
        full_name,
        phone,
        email: getString(formData, "customer_email"),
        date_of_birth: getString(formData, "customer_date_of_birth"),
        gender: getString(formData, "customer_gender"),
        address_line: getString(formData, "customer_address_line"),
        area: getString(formData, "customer_area"),
        city: getString(formData, "customer_city"),
        pincode: getString(formData, "customer_pincode"),
        notes: getString(formData, "customer_notes"),
        created_by: opsUser.id,
      })
      .select("id, full_name, phone")
      .single();

    if (insertErr || !created) {
      throw new Error(`Could not create customer: ${insertErr?.message ?? "unknown"}`);
    }
    const newCustomer = created as NewCustomerRow;
    customerId = newCustomer.id;
    customerName = newCustomer.full_name;
    customerPhone = newCustomer.phone ?? phone;
  }

  // ---- Resolve optional partner ----
  let partnerId: string | null = null;
  const partnerLookup = getString(formData, "partner_lookup");
  if (partnerLookup) {
    type PartnerRow = { id: string };
    let row: PartnerRow | null = null;
    if (UUID_RE.test(partnerLookup)) {
      const { data } = await supabase
        .from("partners")
        .select("id")
        .eq("id", partnerLookup)
        .maybeSingle();
      row = (data as PartnerRow | null) ?? null;
    } else {
      const { data } = await supabase
        .from("partners")
        .select("id")
        .eq("partner_code", partnerLookup.toUpperCase())
        .maybeSingle();
      row = (data as PartnerRow | null) ?? null;
    }
    if (!row) {
      throw new Error(`No partner found for "${partnerLookup}"`);
    }
    partnerId = row.id;
  }

  // ---- Insert the booking ----
  const initialStatus: BookingStatus = "PENDING";

  const { data: inserted, error: bookingErr } = await supabase
    .from("bookings")
    .insert({
      customer_id: customerId,
      partner_id: partnerId,
      // Legacy inline columns — populated from customer so /ops/lab etc.
      // continue to render the booking correctly.
      patient_name: customerName,
      phone: customerPhone,
      // Booking-level fields
      service_category,
      manual_address,
      amount,
      ops_notes: getString(formData, "ops_notes"),
      scheduled_for,
      status: initialStatus,
      // booking_code: NULL — trg_bookings_assign_code (migration 015)
      // stamps SAN-B-NNNNN via next_code('booking').
    })
    .select("id")
    .single();

  if (bookingErr || !inserted) {
    throw new Error(`Could not create booking: ${bookingErr?.message ?? "unknown"}`);
  }

  revalidatePath("/ops/bookings");
  if (mode === "new") {
    revalidatePath("/ops/patients");
    revalidatePath(`/ops/patients/${customerId}`);
  }
  redirect(`/ops/bookings/${inserted.id}`);
}
