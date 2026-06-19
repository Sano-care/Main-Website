"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { normaliseIndianPhone } from "@/lib/phone";
import { getCurrentOpsUser } from "../../_lib/getCurrentOpsUser";
import {
  isBookingStatus,
  SERVICE_CATEGORIES,
  type BookingStatus,
} from "../../_lib/bookingStatus";
import {
  generateConsultJoinToken,
  defaultJoinTokenExpiry,
} from "@/lib/consult/tokens";
import { sendConsultJoinLink } from "@/lib/consult/meta";
import {
  sendVisitComplete,
  sendLabCollectionScheduled,
  labTimeWindowFromDate,
} from "@/lib/aarogya/meta";
import { serviceCategoryToSlug } from "@/lib/aarogya/labels";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAN_C_RE = /^SAN-C-\d+$/i;

export type CustomerLookupResult =
  | {
      ok: true;
      customer: {
        id: string;
        customer_code: string;
        full_name: string;
        phone: string;
      };
    }
  | { ok: false; error: string };

/**
 * Resolve a SAN-C code OR a phone number to a customer row. Used by the
 * /ops/bookings/new "existing patient" lookup. Returns a serialisable
 * result the client uses to render either a confirm panel or an error.
 *
 * Lookup semantics:
 *   - SAN-C-NNNNN (case-insensitive) → exact match on customer_code.
 *   - Otherwise treat as a phone, normalise via normaliseIndianPhone() and
 *     exact-match on customers.phone (M016 enforces uniqueness).
 *
 * Always re-fetched server-side at booking creation, so the client cannot
 * spoof the customer id of a row it didn't actually look up.
 */
export async function lookupCustomer(input: string): Promise<CustomerLookupResult> {
  await getCurrentOpsUser();
  const supabase = await createOpsRSCClient();

  const q = (input ?? "").trim();
  if (!q) return { ok: false, error: "Enter a SAN-C code or phone number." };

  type Row = { id: string; customer_code: string; full_name: string; phone: string | null };
  let row: Row | null = null;

  if (SAN_C_RE.test(q)) {
    const { data } = await supabase
      .from("customers")
      .select("id, customer_code, full_name, phone")
      .eq("customer_code", q.toUpperCase())
      .maybeSingle();
    row = (data as Row | null) ?? null;
    if (!row) {
      return { ok: false, error: `No patient with code ${q.toUpperCase()}.` };
    }
  } else {
    const normalised = normaliseIndianPhone(q);
    if (!normalised) {
      return {
        ok: false,
        error:
          "That doesn't look like a SAN-C code or an Indian mobile. Use a 10-digit number, or paste the SAN-C-NNNNN code.",
      };
    }
    const { data } = await supabase
      .from("customers")
      .select("id, customer_code, full_name, phone")
      .eq("phone", normalised)
      .maybeSingle();
    row = (data as Row | null) ?? null;
    if (!row) {
      return {
        ok: false,
        error: `No patient on file for ${normalised}. Switch to "Create new patient".`,
      };
    }
  }

  if (!row.phone) {
    return {
      ok: false,
      error: `${row.full_name} has no phone on file — add one via /ops/patients first.`,
    };
  }
  return {
    ok: true,
    customer: {
      id: row.id,
      customer_code: row.customer_code,
      full_name: row.full_name,
      phone: row.phone,
    },
  };
}

// =====================================================================
// resolveShortMapsLink — server-side redirect follower for short Maps URLs
// =====================================================================
//
// Google Maps' "Share" button produces short links like
// https://maps.app.goo.gl/abc123 or https://goo.gl/maps/xyz. These are
// HTTP 301/302 redirects to a long maps URL that contains the actual
// coordinates (@lat,lng,zoom and/or !3dLAT!4dLNG). The client can't
// follow them cross-origin, so the NewBookingForm calls this action on
// blur when the pasted value looks like a short URL.
//
// SSRF guardrails: we only hit a small allow-list of Google short-URL
// hosts, never read the response body, and abort after 5s. We return
// only the parsed coordinates — the resolved URL itself is discarded.

const SHORT_MAPS_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "g.co",
  "www.google.com", // sometimes Share emits the long form directly
  "maps.google.com",
]);

export type ShortLinkResolveResult =
  | { ok: true; lat: number; lng: number }
  | { ok: false; error: string };

function parseLatLngFromUrl(url: string): { lat: number; lng: number } | null {
  const tryPair = (latStr: string, lngStr: string) => {
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    ) {
      return { lat, lng };
    }
    return null;
  };

  // Try the same patterns the client uses, in priority order. !3d!4d wins
  // when both are present because it represents the placemark coordinate;
  // @lat,lng is the camera centre which can drift from the marker.
  const place = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (place) {
    const p = tryPair(place[1], place[2]);
    if (p) return p;
  }
  const at = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) {
    const p = tryPair(at[1], at[2]);
    if (p) return p;
  }
  const q = url.match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (q) {
    const p = tryPair(q[1], q[2]);
    if (p) return p;
  }
  const ll = url.match(/[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (ll) {
    const p = tryPair(ll[1], ll[2]);
    if (p) return p;
  }
  return null;
}

export async function resolveShortMapsLink(
  input: string,
): Promise<ShortLinkResolveResult> {
  // Auth gate: same as every other ops action — non-ops users get 0 IO
  // out of this endpoint.
  await getCurrentOpsUser();

  const trimmed = (input ?? "").trim();
  if (!trimmed) return { ok: false, error: "Empty link." };

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    return { ok: false, error: "Not a valid URL." };
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return { ok: false, error: "Only http(s) URLs are followed." };
  }
  if (!SHORT_MAPS_HOSTS.has(parsedUrl.host)) {
    return {
      ok: false,
      error: `Refusing to follow ${parsedUrl.host} — only Google Maps hosts are allowed.`,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(parsedUrl.toString(), {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: {
        // Plain UA — Google's URL shortener serves the redirect to almost
        // anything, but pretending to be a real browser avoids the
        // occasional bot-flavoured response.
        "User-Agent":
          "Mozilla/5.0 (compatible; Sanocare/1.0; +https://sanocare.in)",
        Accept: "text/html,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    // Resolved URL after all redirects (undici sets this on `response.url`).
    const finalUrl = res.url;
    const coords = parseLatLngFromUrl(finalUrl);
    if (!coords) {
      return {
        ok: false,
        error:
          "Followed the short link but didn't find coordinates in the resolved URL. Try opening the link in Maps and pasting the expanded URL instead.",
      };
    }
    return { ok: true, lat: coords.lat, lng: coords.lng };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: "Timed out following the short link." };
    }
    return {
      ok: false,
      error: "Couldn't reach the short link. Check your connection and try again.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

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
  // patient_name / phone / service_category are pulled for the Slice 2a
  // visit-complete WhatsApp send on the COMPLETED transition.
  const { data: current, error: readErr } = await supabase
    .from("bookings")
    .select("status, assigned_at, patient_name, phone, service_category")
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

  // C2: keep the linked consultation_session.status in sync with the
  // terminal booking states. The doctor queue on /doctor filters by
  // session status, so a teleconsult that finished in the call but
  // whose session row is still 'scheduled' would otherwise haunt the
  // queue forever. C3-V's Daily meeting.ended webhook will update this
  // directly and this side-effect can be removed then.
  if (newStatus === "COMPLETED") {
    await mirrorSessionStatus(supabase, bookingId, "completed");
  }

  // Slice 2a — notify the patient when their visit is marked COMPLETED,
  // carrying the 3 satisfaction Quick-Reply buttons. Best-effort: never
  // blocks the status transition (the booking row is authoritative).
  // NOTE: receiving the button taps requires a Rampwin inbound webhook,
  // which does not exist yet — this only sends. The `feedback_response`
  // column (M045) is the storage target for when that inbound lands.
  if (newStatus === "COMPLETED" && current.phone) {
    try {
      const { delivered } = await sendVisitComplete({
        patientName: current.patient_name ?? "",
        serviceSlug: serviceCategoryToSlug(current.service_category),
        patientPhone: current.phone,
      });
      console.log(
        `[changeStatus] aarogya_visit_complete dispatch: delivered=${delivered} booking=${bookingId}`,
      );
    } catch (sendErr) {
      console.error(
        "[changeStatus] aarogya_visit_complete threw unexpectedly",
        sendErr,
      );
    }
  }

  revalidateBooking(bookingId);
}

/**
 * Mirror a booking's terminal status onto its linked
 * consultation_session, if any. No-op for non-teleconsult bookings
 * (no session row exists). Failures log but don't throw — the booking
 * update is the load-bearing operation; the session UI cleanliness is
 * cosmetic.
 */
async function mirrorSessionStatus(
  supabase: Awaited<ReturnType<typeof createOpsRSCClient>>,
  bookingId: string,
  status: "completed" | "cancelled",
): Promise<void> {
  const { error } = await supabase
    .from("consultation_sessions")
    .update({
      status,
      ...(status === "completed" ? { ended_at: new Date().toISOString() } : {}),
    })
    .eq("booking_id", bookingId);
  if (error) {
    console.warn(
      `[mirrorSessionStatus] could not update session for booking ${bookingId} -> ${status} (non-fatal):`,
      error,
    );
  }
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
 * Slice 2a — confirm the phlebotomist + collection slot for a lab booking
 * and notify the patient (sanocare_lab_collection_scheduled).
 *
 * Lab bookings don't flow through assignMedic (that gates to homecare
 * / chronic only), so the phlebotomist is recorded on the legacy text
 * column `bookings.assigned_paramedic`. This action writes that +
 * scheduled_for, guards that the row is a lab/diagnostics booking, then
 * fires the patient template best-effort (never blocks the DB write).
 * The time window (7-10 AM / 5-8 PM) is derived from the slot's IST hour.
 *
 * Form fields: booking_id (uuid), phlebotomist_name (text),
 * scheduled_for (datetime-local).
 */
export async function confirmLabCollection(formData: FormData) {
  await getCurrentOpsUser();
  const bookingId = getRequired(formData, "booking_id");
  const phlebotomistName = getRequired(formData, "phlebotomist_name");
  const slotRaw = getRequired(formData, "scheduled_for");

  const slot = new Date(slotRaw);
  if (Number.isNaN(slot.getTime())) {
    throw new Error("Invalid collection slot time.");
  }

  const supabase = await createOpsRSCClient();

  const { data: booking, error: readErr } = await supabase
    .from("bookings")
    .select("patient_name, phone, service_category")
    .eq("id", bookingId)
    .maybeSingle();
  if (readErr || !booking) {
    throw new Error(
      `Could not read booking: ${readErr?.message ?? "not found"}`,
    );
  }
  if (serviceCategoryToSlug(booking.service_category) !== "lab-tests") {
    throw new Error("Collection scheduling is only for lab-test bookings.");
  }

  const { error } = await supabase
    .from("bookings")
    .update({
      assigned_paramedic: phlebotomistName,
      scheduled_for: slot.toISOString(),
    })
    .eq("id", bookingId);
  if (error) {
    throw new Error(`Could not confirm collection: ${error.message}`);
  }

  if (booking.phone) {
    try {
      const { delivered } = await sendLabCollectionScheduled({
        patientName: booking.patient_name ?? "",
        phlebotomistName,
        scheduledFor: slot,
        timeWindow: labTimeWindowFromDate(slot),
        patientPhone: booking.phone,
      });
      console.log(
        `[confirmLabCollection] sanocare_lab_collection_scheduled dispatch: delivered=${delivered} booking=${bookingId}`,
      );
    } catch (sendErr) {
      console.error(
        "[confirmLabCollection] lab collection send threw unexpectedly",
        sendErr,
      );
    }
  }

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

  // C2: mirror onto the linked consultation_session, if any.
  await mirrorSessionStatus(supabase, bookingId, "cancelled");

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

// =====================================================================
// Ops Framework Phase 1 (M032) — resource assignment actions
// =====================================================================
//
// Three actions share the same shape: read the booking, validate the
// service_category allows this resource type, validate the target
// resource exists + is active, UPDATE with both the resource id and the
// (assigned_at, assigned_by) audit columns. Empty target unassigns.
//
// Service-category gating (founder brief table, mapped to canonical
// SERVICE_CATEGORIES from bookingStatus.ts):
//   - assignDoctor:     teleconsult, homecare, chronic
//   - assignMedic:      homecare, chronic
//   - assignPartner:    diagnostics
//
// The brief used informal labels "nursing" (mapped to chronic) and
// "pathology" (mapped to diagnostics) — those are not canonical
// values. The constant maps below are the single source of truth; if
// SERVICE_CATEGORIES is extended later, update them here.
//
// On the doctor side: Finding 4 from the M032 Step 0 — bookings.doctor_id
// is pre-existing and is the doctor-assignment column (no
// assigned_doctor_id was added). The (assigned_at, assigned_by) audit
// columns ARE new from M032 and apply to all three assignment kinds.
//
// On the partner side: bookings.partner_id (pre-existing) carries the
// legacy "linked organization" concept (used by linkCustomer/linkPartner
// for lab bookings, etc.). bookings.assigned_partner_id (new in M032)
// is the formal "ops assigned this partner for this booking's service"
// concept. They are intentionally separate; assignPartner writes the
// new column, linkPartner continues to write the legacy one.

const ASSIGN_DOCTOR_ALLOWED_CATEGORIES = new Set([
  "teleconsult",
  "homecare",
  "chronic",
]);
const ASSIGN_PARAMEDIC_ALLOWED_CATEGORIES = new Set([
  "homecare",
  "chronic",
]);
const ASSIGN_PARTNER_ALLOWED_CATEGORIES = new Set(["diagnostics"]);

/**
 * Read the booking's service_category for the assignment validators.
 * Throws if booking missing — caller chains revalidate after success.
 */
async function readServiceCategory(
  supabase: Awaited<ReturnType<typeof createOpsRSCClient>>,
  bookingId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("bookings")
    .select("service_category")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw new Error(`Could not read booking: ${error.message}`);
  if (!data) throw new Error(`Booking not found: ${bookingId}`);
  return (data as { service_category: string | null }).service_category ?? "";
}

/**
 * Assign a doctor to a booking. M032 wires the (assigned_at,
 * assigned_by) audit columns alongside the pre-existing doctor_id.
 *
 * Any ops user — admin or agent — can call this; UPDATE on bookings
 * goes through the M2 booking RLS (allows authenticated ops UPDATE).
 *
 * The doctor earning posts to the ledger only on the COMPLETED
 * transition via trg_bookings_doctor_earnings (M019), not here.
 *
 * Accepts the doctor's UUID; empty/missing value unassigns (doctor_id
 * → null) AND clears the audit columns (unassign is a fresh start).
 *
 * Idempotency: re-assigning the same doctor refreshes assigned_at
 * to "now" (intentional — surface to ops that the assignment was
 * re-confirmed).
 */
export async function assignDoctor(formData: FormData) {
  const opsUser = await getCurrentOpsUser();
  const bookingId = getRequired(formData, "booking_id");
  const supabase = await createOpsRSCClient();

  const target = getString(formData, "doctor_id");
  let doctor_id: string | null = null;

  if (target) {
    if (!UUID_RE.test(target)) {
      throw new Error("Invalid doctor id.");
    }
    // M032 gate: service_category must allow a doctor.
    const category = await readServiceCategory(supabase, bookingId);
    if (!ASSIGN_DOCTOR_ALLOWED_CATEGORIES.has(category)) {
      throw new Error(
        `Can't assign a doctor to a ${category} booking. Doctors are for teleconsult / homecare / chronic only.`,
      );
    }
    // Re-fetch the doctor to confirm active. RLS-readable to any ops user.
    const { data: doc } = await supabase
      .from("doctors")
      .select("id, is_active")
      .eq("id", target)
      .maybeSingle();
    if (!doc) throw new Error("Doctor not found.");
    if (!doc.is_active) {
      throw new Error("That doctor is inactive — pick an active one.");
    }
    doctor_id = doc.id;
  }

  // On unassign (doctor_id = null), also clear the audit columns —
  // assigned_at represents the most recent assignment action across
  // all roles, so leaving stale values when the resource is removed
  // would mis-report.
  const update: Record<string, unknown> = doctor_id
    ? {
        doctor_id,
        assigned_at: new Date().toISOString(),
        assigned_by: opsUser.id,
      }
    : { doctor_id: null };

  const { error } = await supabase
    .from("bookings")
    .update(update)
    .eq("id", bookingId);
  if (error) throw new Error(`Could not assign doctor: ${error.message}`);

  revalidateBooking(bookingId);
}

/**
 * Assign a medic to a booking. T65 Phase 2 (M053+M054, 2026-06-17):
 * paramedics table retired; medics is canonical (M049). Finishes the
 * half-done refactor (the old comment about "table is called paramedics
 * for legacy reasons" is now resolved).
 *
 * M032 added (assigned_at, assigned_by) audit columns — both still
 * populated. The old assigned_paramedic_id column dropped in M054;
 * medic_id (M053) replaces it. Empty target unassigns.
 *
 * Service category must allow a medic (homecare / chronic).
 */
export async function assignMedic(formData: FormData) {
  const opsUser = await getCurrentOpsUser();
  const bookingId = getRequired(formData, "booking_id");
  const supabase = await createOpsRSCClient();

  const target = getString(formData, "medic_id");
  let medic_id: string | null = null;

  if (target) {
    if (!UUID_RE.test(target)) {
      throw new Error("Invalid medic id.");
    }
    const category = await readServiceCategory(supabase, bookingId);
    if (!ASSIGN_PARAMEDIC_ALLOWED_CATEGORIES.has(category)) {
      throw new Error(
        `Can't assign a medic to a ${category} booking. Medics are for homecare / chronic only.`,
      );
    }
    const { data: medic } = await supabase
      .from("medics")
      .select("id, active")
      .eq("id", target)
      .maybeSingle();
    if (!medic) throw new Error("Medic not found.");
    if (medic.active === false) {
      throw new Error("That medic is inactive — pick an active one.");
    }
    medic_id = medic.id;
  }

  const update: Record<string, unknown> = medic_id
    ? {
        medic_id,
        assigned_at: new Date().toISOString(),
        assigned_by: opsUser.id,
      }
    : { medic_id: null };

  const { error } = await supabase
    .from("bookings")
    .update(update)
    .eq("id", bookingId);
  if (error) {
    throw new Error(`Could not assign medic: ${error.message}`);
  }

  // Slice 3 (T66) — fire the patient-facing `medic_assigned` notification.
  // Only on a real assignment (not on unassign / medic_id = null).
  // CRITICAL: notification failure must NOT block the assignment from the
  // ops user's perspective — the helper itself is best-effort + never-
  // throws; revalidateBooking runs regardless.
  if (medic_id) {
    const { notifyOnMedicAssigned } = await import(
      "@/lib/whatsapp/slice3Dispatcher"
    );
    void (await notifyOnMedicAssigned(supabase, bookingId, medic_id));
  }

  revalidateBooking(bookingId);
}

/**
 * Assign a partner (lab / diagnostic vendor) to a booking. Writes
 * the new bookings.assigned_partner_id column (M032), distinct from
 * the legacy bookings.partner_id which linkPartner continues to
 * manage. Empty target unassigns.
 *
 * Service category must allow a partner (diagnostics).
 *
 * Why two partner columns: bookings.partner_id is the broader
 * "linked organization" concept (lab bookings created via /api/lab/
 * create-booking, etc.). bookings.assigned_partner_id is the formal
 * "ops assigned this partner for fulfillment of this booking" concept
 * with audit columns. They serve different use cases; ops admin may
 * later collapse them in a follow-up migration after the framework
 * matures.
 */
export async function assignPartner(formData: FormData) {
  const opsUser = await getCurrentOpsUser();
  const bookingId = getRequired(formData, "booking_id");
  const supabase = await createOpsRSCClient();

  const target = getString(formData, "partner_id");
  let assigned_partner_id: string | null = null;

  if (target) {
    if (!UUID_RE.test(target)) {
      throw new Error("Invalid partner id.");
    }
    const category = await readServiceCategory(supabase, bookingId);
    if (!ASSIGN_PARTNER_ALLOWED_CATEGORIES.has(category)) {
      throw new Error(
        `Can't assign a partner to a ${category} booking. Partners are for diagnostics only.`,
      );
    }
    const { data: partner } = await supabase
      .from("partners")
      .select("id, is_active")
      .eq("id", target)
      .maybeSingle();
    if (!partner) throw new Error("Partner not found.");
    if (partner.is_active === false) {
      throw new Error("That partner is inactive — pick an active one.");
    }
    assigned_partner_id = partner.id;
  }

  const update: Record<string, unknown> = assigned_partner_id
    ? {
        assigned_partner_id,
        assigned_at: new Date().toISOString(),
        assigned_by: opsUser.id,
      }
    : { assigned_partner_id: null };

  const { error } = await supabase
    .from("bookings")
    .update(update)
    .eq("id", bookingId);
  if (error) {
    throw new Error(`Could not assign partner: ${error.message}`);
  }

  revalidateBooking(bookingId);
}

type SelectedTest = {
  code: string;
  name: string;
  price: number;
  sample?: string;
  tat?: string;
  category?: string;
};

type AppliedCouponPayload = {
  code: string;
  discount_percent: number;
  discount_inr: number;
};

/** Best-effort parse of a JSON form field. Returns null on empty/invalid. */
function getJSON<T>(formData: FormData, key: string): T | null {
  const raw = getString(formData, key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Validate gps_location coming from the form: object with finite lat in
 * [-90, 90], lng in [-180, 180], accuracy >= 0. Anything else throws.
 */
function parseGpsLocation(formData: FormData): { lat: number; lng: number; accuracy: number } {
  const raw = getJSON<{ lat?: unknown; lng?: unknown; accuracy?: unknown }>(formData, "gps_location");
  if (!raw) {
    throw new Error("Location is required — paste a Google Maps link or lat,long.");
  }
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  const accuracy = raw.accuracy == null ? 0 : Number(raw.accuracy);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error("Latitude is out of range.");
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error("Longitude is out of range.");
  }
  if (!Number.isFinite(accuracy) || accuracy < 0) {
    throw new Error("Accuracy must be a non-negative number.");
  }
  return { lat, lng, accuracy };
}

/**
 * Create a booking on behalf of a patient (the "ops logs a WhatsApp
 * booking" flow).
 *
 * Customer:
 *   - "existing" mode: the client has already called lookupCustomer() and
 *     passes the resolved `customer_id`. We re-fetch the row server-side
 *     to avoid trusting client-provided ids.
 *   - "new" mode: create the customer inline using next_code('customer'),
 *     normalising the phone to E.164 via normaliseIndianPhone.
 *
 * Location:
 *   - gps_location is required (the form parses Google Maps URL / lat,lng).
 *   - manual_address stays optional — supplementary "flat / floor /
 *     landmark" detail.
 *
 * Diagnostics:
 *   - When service_category = 'diagnostics', selected_tests + the optional
 *     applied_coupon shape the row exactly like /api/lab/create-booking
 *     does for the public flow, with status PENDING_COLLECTION,
 *     lab_partner 'pathcore', report_payment_status 'NOT_DUE'.
 *   - All other services get status PENDING.
 *
 * The legacy inline `patient_name` + `phone` columns are populated from
 * the resolved customer so /ops/lab and any other reader of those columns
 * keeps working. `booking_code` is left NULL — the trg_bookings_assign_code
 * trigger from migration 015 stamps it on INSERT.
 */
export async function createBooking(formData: FormData) {
  const opsUser = await getCurrentOpsUser();

  // ---- Validate booking-level fields first ----
  const mode = formData.get("customer_mode");
  if (mode !== "existing" && mode !== "new") {
    throw new Error("Invalid customer mode");
  }

  const service_category = getRequired(formData, "service_category");
  if (!(SERVICE_CATEGORIES as readonly string[]).includes(service_category)) {
    throw new Error(`Invalid service: ${service_category}`);
  }

  // C2: teleconsult requires a doctor at create time. The
  // consultation_sessions FK is NOT NULL, so we can't defer this to
  // assignDoctor() the way the other modalities do. Read + validate
  // here so the booking insert below can carry the doctor_id atomically.
  let teleconsultDoctor: {
    id: string;
    full_name: string;
    duty_room_join_url: string | null;
  } | null = null;
  if (service_category === "teleconsult") {
    const doctor_id = getString(formData, "doctor_id");
    if (!doctor_id || !UUID_RE.test(doctor_id)) {
      throw new Error(
        "Pick a doctor for the teleconsultation — the patient's join link routes to their Duty Room.",
      );
    }
    const supabasePre = await createOpsRSCClient();
    type DocRow = {
      id: string;
      full_name: string;
      duty_room_join_url: string | null;
      is_active: boolean;
    };
    const { data: docRow } = await supabasePre
      .from("doctors")
      .select("id, full_name, duty_room_join_url, is_active")
      .eq("id", doctor_id)
      .maybeSingle();
    const doc = (docRow as DocRow | null) ?? null;
    if (!doc) {
      throw new Error("Doctor not found.");
    }
    if (!doc.is_active) {
      throw new Error("That doctor is inactive — pick an active one.");
    }
    // doc.duty_room_join_url may be NULL — we still create the session,
    // and the /c/[token] page surfaces a graceful "not set up yet"
    // fallback. Ops gets the booking created (so the customer isn't
    // dropped) plus a clear next step.
    teleconsultDoctor = {
      id: doc.id,
      full_name: doc.full_name,
      duty_room_join_url: doc.duty_room_join_url,
    };
  }

  // Location is mandatory; manual_address (flat / floor / landmark) is not.
  const gps_location = parseGpsLocation(formData);
  const manual_address = getString(formData, "manual_address") ?? "";

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

  // ---- Diagnostics-only fields ----
  let selectedTests: SelectedTest[] = [];
  let appliedCoupon: AppliedCouponPayload | null = null;
  if (service_category === "diagnostics") {
    const parsedTests = getJSON<SelectedTest[]>(formData, "selected_tests");
    if (!parsedTests || !Array.isArray(parsedTests) || parsedTests.length === 0) {
      throw new Error("Pick at least one lab test for a diagnostics booking.");
    }
    // Defensive shape check + normalize numbers.
    selectedTests = parsedTests.map((t) => {
      if (!t || typeof t.code !== "string" || typeof t.name !== "string") {
        throw new Error("Invalid lab test in basket.");
      }
      const price = Number(t.price);
      if (!Number.isFinite(price) || price < 0) {
        throw new Error(`Test ${t.code} has an invalid price.`);
      }
      return {
        code: t.code,
        name: t.name,
        price,
        sample: typeof t.sample === "string" ? t.sample : undefined,
        tat: typeof t.tat === "string" ? t.tat : undefined,
        category: typeof t.category === "string" ? t.category : undefined,
      };
    });

    appliedCoupon = getJSON<AppliedCouponPayload>(formData, "applied_coupon");
    if (appliedCoupon) {
      const pct = Number(appliedCoupon.discount_percent);
      const inr = Number(appliedCoupon.discount_inr);
      if (!appliedCoupon.code || !Number.isFinite(pct) || !Number.isFinite(inr)) {
        throw new Error("Invalid coupon payload.");
      }
      appliedCoupon = { code: appliedCoupon.code, discount_percent: pct, discount_inr: inr };
    }
  }

  const supabase = await createOpsRSCClient();

  // ---- Resolve customer (existing) or create (new) ----
  let customerId: string;
  let customerName: string;
  let customerPhone: string;

  if (mode === "existing") {
    const id = getRequired(formData, "customer_id");
    if (!UUID_RE.test(id)) {
      throw new Error("Invalid customer id — re-run the patient lookup.");
    }
    type Row = { id: string; full_name: string; phone: string | null };
    const { data } = await supabase
      .from("customers")
      .select("id, full_name, phone")
      .eq("id", id)
      .maybeSingle();
    const row = (data as Row | null) ?? null;
    if (!row) {
      throw new Error("That patient no longer exists — re-run the lookup.");
    }
    if (!row.phone) {
      throw new Error(
        `${row.full_name} has no phone on file — add one via /ops/patients first.`,
      );
    }
    customerId = row.id;
    customerName = row.full_name;
    customerPhone = row.phone;
  } else {
    const full_name = getRequired(formData, "customer_full_name");
    const phoneRaw = getRequired(formData, "customer_phone");
    const phone = normaliseIndianPhone(phoneRaw);
    if (!phone) {
      throw new Error(
        `"${phoneRaw}" is not a valid Indian mobile. Use a 10-digit number starting 6-9.`,
      );
    }

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
      // 23505 = unique_violation — the new M016 UNIQUE on customers.phone caught a dupe.
      if (insertErr && (insertErr.code === "23505" || /duplicate key/i.test(insertErr.message))) {
        throw new Error(
          `A patient with phone ${phone} already exists. Switch to "Existing patient" and look them up.`,
        );
      }
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

  // ---- Build the row to insert ----
  // For diagnostics we mirror /api/lab/create-booking: status starts at
  // PENDING_COLLECTION, lab_partner / report_payment_status seeded.
  const isDiagnostics = service_category === "diagnostics";
  const initialStatus: BookingStatus = isDiagnostics ? "PENDING_COLLECTION" : "PENDING";

  type BookingInsert = {
    customer_id: string;
    partner_id: string | null;
    patient_name: string;
    phone: string;
    service_category: string;
    manual_address: string;
    gps_location: { lat: number; lng: number; accuracy: number };
    amount: number | null;
    ops_notes: string | null;
    scheduled_for: string | null;
    status: BookingStatus;
    doctor_id?: string;
    selected_tests?: SelectedTest[];
    test_total_paise?: number;
    applied_coupon_code?: string | null;
    coupon_discount_percent?: number | null;
    coupon_discount_paise?: number | null;
    final_amount_paise?: number;
    lab_partner?: string;
    report_payment_status?: string;
  };

  const bookingRow: BookingInsert = {
    customer_id: customerId,
    partner_id: partnerId,
    patient_name: customerName,
    phone: customerPhone,
    service_category,
    manual_address,
    gps_location,
    amount,
    ops_notes: getString(formData, "ops_notes"),
    scheduled_for,
    status: initialStatus,
  };

  // Teleconsult sets doctor_id at booking-create time so M4's earning
  // trigger has the right doctor on file when the booking later
  // transitions to COMPLETED.
  if (teleconsultDoctor) {
    bookingRow.doctor_id = teleconsultDoctor.id;
  }

  if (isDiagnostics) {
    const testTotalRupees = selectedTests.reduce((s, t) => s + t.price, 0);
    const testTotalPaise = Math.round(testTotalRupees * 100);
    const couponDiscountPaise = appliedCoupon
      ? Math.round(appliedCoupon.discount_inr * 100)
      : 0;
    const finalAmountPaise = Math.max(0, testTotalPaise - couponDiscountPaise);
    bookingRow.selected_tests = selectedTests;
    bookingRow.test_total_paise = testTotalPaise;
    bookingRow.applied_coupon_code = appliedCoupon?.code ?? null;
    bookingRow.coupon_discount_percent = appliedCoupon?.discount_percent ?? null;
    bookingRow.coupon_discount_paise = couponDiscountPaise || null;
    bookingRow.final_amount_paise = finalAmountPaise;
    bookingRow.lab_partner = "pathcore";
    bookingRow.report_payment_status = "NOT_DUE";
    // For diagnostics, leave the legacy `amount` at 0 — the real number
    // is in final_amount_paise, mirroring /api/lab/create-booking.
    if (bookingRow.amount == null) bookingRow.amount = 0;
  }

  const { data: inserted, error: bookingErr } = await supabase
    .from("bookings")
    .insert(bookingRow)
    .select("id")
    .single();

  if (bookingErr || !inserted) {
    throw new Error(`Could not create booking: ${bookingErr?.message ?? "unknown"}`);
  }

  // ----------------------------------------------------------------
  // C2: teleconsult side-effects — consultation_session + patient
  // participant + Rampwin join-link delivery. Runs only when
  // teleconsultDoctor was resolved above.
  //
  // Failure posture:
  //   - Session insert failure THROWS — the booking row exists but the
  //     consultation didn't materialise; ops sees the error and can
  //     clean up. (We don't roll back the booking automatically because
  //     RLS / triggers can fire side-effects we don't want to undo by
  //     hand. Manual cleanup is rare and acceptable for C2.)
  //   - Participant insert failure THROWS for the same reason.
  //   - Rampwin send failure LOGS and continues — the patient can
  //     receive the link out-of-band via ops; the booking + session +
  //     token are all in place. C3 will add a "Resend join link"
  //     affordance on the booking detail page once webhooks land.
  // ----------------------------------------------------------------
  if (teleconsultDoctor) {
    const scheduledAtIso = scheduled_for ?? new Date().toISOString();

    const { data: session, error: sessionErr } = await supabase
      .from("consultation_sessions")
      .insert({
        booking_id: inserted.id,
        doctor_id: teleconsultDoctor.id,
        modality: "teleconsultation",
        status: "scheduled",
        // Snapshot the doctor's Duty Room URL at create time. May be
        // NULL (doctor not yet provisioned); the /c/[token] page
        // surfaces a fallback in that case.
        duty_room_url_snapshot: teleconsultDoctor.duty_room_join_url,
        scheduled_at: scheduledAtIso,
        created_by: opsUser.id,
      })
      .select("id")
      .single();
    if (sessionErr || !session) {
      throw new Error(
        `Booking ${inserted.id} was created but the consultation session insert failed: ${sessionErr?.message ?? "unknown"}. Clean up via SQL and re-create.`,
      );
    }

    const joinToken = generateConsultJoinToken();
    const tokenExpiry = defaultJoinTokenExpiry(scheduledAtIso);
    const { error: partErr } = await supabase
      .from("consultation_participants")
      .insert({
        session_id: session.id,
        role: "patient",
        customer_id: customerId,
        join_token: joinToken,
        join_token_expires_at: tokenExpiry.toISOString(),
      });
    if (partErr) {
      throw new Error(
        `Booking ${inserted.id} + session ${session.id} created, but the patient participant insert failed: ${partErr.message}. The link cannot be delivered.`,
      );
    }

    // Best-effort WhatsApp delivery. The Rampwin template
    // (`sanocare_consult_join`) is provisioned by the founder/BSP —
    // until that's done, this throw is the expected failure and ops
    // delivers the link out-of-band.
    try {
      await sendConsultJoinLink({
        phone: customerPhone,
        joinToken,
        patientName: customerName,
        doctorName: teleconsultDoctor.full_name,
      });
      console.log("[createBooking] consult join-link delivered", {
        booking_id: inserted.id,
        session_id: session.id,
      });
    } catch (err) {
      console.error(
        "[createBooking] Rampwin consult-join delivery failed (non-fatal — booking + session + token are in place):",
        err,
      );
    }
  }

  revalidatePath("/ops/bookings");
  // Explicitly invalidate the new booking's detail URL too. The page is
  // force-dynamic + no-store, so it shouldn't be cached anywhere — but
  // calling revalidatePath here defends against any router-cache entry
  // that might otherwise short-circuit the redirect target.
  revalidatePath(`/ops/bookings/${inserted.id}`);
  if (mode === "new") {
    revalidatePath("/ops/patients");
    revalidatePath(`/ops/patients/${customerId}`);
  }
  redirect(`/ops/bookings/${inserted.id}`);
}
