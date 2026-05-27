"use server";

// =====================================================================
// Doctor server actions for the e-prescription lifecycle (C2-Rx).
//
// Surface contract:
//   createDraftPrescription(formData)   → opens or reuses a draft Rx
//   updatePrescriptionDraft(formData)   → save composer state
//   sendPrescription(formData)          → render, upload, deliver
//   amendPrescription(formData)         → fork v(N+1) from a sent v(N)
//   voidPrescription(formData)          → kill a sent Rx (with reason)
//
// A1 ENFORCEMENT
// --------------
// Every action calls getCurrentDoctor() first and then re-loads the
// target row (session / prescription) and asserts the doctor_id on
// that row equals the logged-in doctor's id. The doctor_id is NEVER
// taken from a form field — only from the verified cookie. This is
// the same posture as the doctor-side data accessors in _lib/.
//
// The amend chain rule (Q1 from M023 design):
//   - v1 is created with prescription_code = next_code('prescription')
//   - v2..vN INHERIT v1's prescription_code (next_code NOT called)
//   - composite UNIQUE (prescription_code, version) is the DB guard
//
// SHAPE OF RESULTS
// ----------------
// Lifecycle actions that have a UI surface to render success vs error
// (e.g. send / amend / void) return a structured RxActionResult so the
// composer / detail view can show "Rx delivered" or "WhatsApp failed,
// here's the link" inline. The composer-save action throws on error
// (server-action exception → form-level error boundary) because the
// composer is a long-running edit surface and a structured result
// would clutter the form ergonomics.
// =====================================================================

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentDoctor } from "../_lib/getCurrentDoctor";
import { supabaseAdmin } from "@/lib/supabase-server";
import { renderPrescriptionPdf } from "@/lib/rx/pdf/renderPrescriptionPdf";
import type { PrescriptionPdfData } from "@/lib/rx/pdf/PrescriptionPdf";
import { generateRxPatientViewToken } from "@/lib/rx/tokens";
import {
  sendRxLink,
  RampwinRxDeliveryError,
  isRxDocumentHeaderEnabled,
} from "@/lib/rx/rampwin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRESCRIPTIONS_BUCKET = "prescriptions";

// ---------------------------------------------------------------------
// Result type used by send / amend / void
// ---------------------------------------------------------------------
export type RxActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; recoverable?: boolean };

// ---------------------------------------------------------------------
// Small parsing helpers (mirror the ops/_actions style)
// ---------------------------------------------------------------------
function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}
function reqStr(formData: FormData, key: string): string {
  const v = str(formData, key);
  if (!v) throw new Error(`${key} is required`);
  return v;
}
function intOrNull(formData: FormData, key: string): number | null {
  const raw = str(formData, key);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`${key} must be an integer`);
  }
  return n;
}
function numOrNull(formData: FormData, key: string): number | null {
  const raw = str(formData, key);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${key} must be a number`);
  }
  return n;
}

// ---------------------------------------------------------------------
// Session ownership check
//
// Resolves a session_id to its row and asserts the doctor_id matches
// the logged-in doctor. Throws on mismatch so the action surface can
// never accidentally write across doctors.
// ---------------------------------------------------------------------
type SessionForRx = {
  id: string;
  booking_id: string;
  doctor_id: string;
  status: string;
  scheduled_at: string;
};
async function assertSessionOwnership(sessionId: string): Promise<{
  doctor: Awaited<ReturnType<typeof getCurrentDoctor>>;
  session: SessionForRx;
}> {
  if (!UUID_RE.test(sessionId)) {
    throw new Error("Invalid session id.");
  }
  const doctor = await getCurrentDoctor();
  const { data, error } = await supabaseAdmin
    .from("consultation_sessions")
    .select("id, booking_id, doctor_id, status, scheduled_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not load session: ${error.message}`);
  }
  if (!data) {
    throw new Error("Consultation session not found.");
  }
  if (data.doctor_id !== doctor.id) {
    // A1: never reveal that the session exists — same shape as ownership
    // mismatch in the ops surface.
    throw new Error("This consultation is not assigned to you.");
  }
  return { doctor, session: data as SessionForRx };
}

// ---------------------------------------------------------------------
// Prescription ownership check (used by update/send/amend/void)
//
// Loads the Rx row and asserts the doctor on the prescription equals
// the logged-in doctor. ALSO loads the parent session and re-asserts
// session ownership (belt-and-suspenders against future writes that
// might forget to validate the session pointer).
// ---------------------------------------------------------------------
type PrescriptionRow = {
  id: string;
  prescription_code: string;
  version: number;
  status: "draft" | "sent" | "superseded" | "voided";
  doctor_id: string;
  session_id: string;
  booking_id: string;
  superseded_by: string | null;
  patient_view_token: string | null;
  pdf_storage_path: string | null;
  sent_at: string | null;
  patient_name: string;
  patient_age: number | null;
  patient_sex: "M" | "F" | "O" | "U" | null;
  patient_weight_kg: number | null;
  chief_complaint: string | null;
  provisional_diagnosis: string | null;
  general_advice: string | null;
  follow_up_advice: string | null;
  // M026: vitals
  bp_sys: number | null;
  bp_dia: number | null;
  pulse_bpm: number | null;
  spo2_pct: number | null;
  temp_c: number | null;
  height_cm: number | null;
};
const RX_SELECT_COLS =
  "id, prescription_code, version, status, doctor_id, session_id, booking_id, superseded_by, patient_view_token, pdf_storage_path, sent_at, patient_name, patient_age, patient_sex, patient_weight_kg, chief_complaint, provisional_diagnosis, general_advice, follow_up_advice, bp_sys, bp_dia, pulse_bpm, spo2_pct, temp_c, height_cm";

async function assertPrescriptionOwnership(prescriptionId: string): Promise<{
  doctor: Awaited<ReturnType<typeof getCurrentDoctor>>;
  rx: PrescriptionRow;
}> {
  if (!UUID_RE.test(prescriptionId)) {
    throw new Error("Invalid prescription id.");
  }
  const doctor = await getCurrentDoctor();
  const { data, error } = await supabaseAdmin
    .from("prescriptions")
    .select(RX_SELECT_COLS)
    .eq("id", prescriptionId)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not load prescription: ${error.message}`);
  }
  if (!data) {
    throw new Error("Prescription not found.");
  }
  const rx = data as PrescriptionRow;
  if (rx.doctor_id !== doctor.id) {
    throw new Error("This prescription is not yours.");
  }
  // Belt-and-suspenders — re-assert through the session pointer.
  await assertSessionOwnership(rx.session_id);
  return { doctor, rx };
}

// ---------------------------------------------------------------------
// Booking patient snapshot
//
// At draft creation time we denormalise the patient block onto the Rx
// row (the PDF is immutable, so it must NOT reach back into the
// bookings row at render time — that row could have moved on / been
// edited by ops).
// ---------------------------------------------------------------------
async function loadBookingPatientSnapshot(bookingId: string): Promise<{
  patient_name: string;
  patient_phone: string | null;
  /** customers.customer_code (SAN-C-XXXXX) — printed as "Patient ID" on the v3 Rx PDF. */
  patient_code: string | null;
  /** bookings.booking_code (SAN-B-XXXXX). */
  booking_code: string | null;
}> {
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select(
      "id, booking_code, patient_name, phone, customer:customers(full_name, phone, customer_code)",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (error || !data) {
    throw new Error(
      `Could not load patient details for booking ${bookingId}: ${
        error?.message ?? "not found"
      }`,
    );
  }
  // Prefer linked customer name (the master record) over the booking-row
  // copy. Same posture as the ops booking-detail header.
  const customer = (data as {
    customer: {
      full_name?: string | null;
      phone?: string | null;
      customer_code?: string | null;
    } | null;
  }).customer;
  const patientName = customer?.full_name ?? (data as { patient_name?: string | null }).patient_name ?? "Patient";
  const patientPhone = customer?.phone ?? (data as { phone?: string | null }).phone ?? null;
  const patientCode = customer?.customer_code ?? null;
  const bookingCode = (data as { booking_code?: string | null }).booking_code ?? null;
  return {
    patient_name: patientName,
    patient_phone: patientPhone,
    patient_code: patientCode,
    booking_code: bookingCode,
  };
}

// ---------------------------------------------------------------------
// Consult-modality formatter
//
// consultation_sessions.modality is one of 'video' / 'audio' / 'in_person'
// today. The Rx template prints it as "Video (Daily.co)" / "Audio (Daily.co)"
// / "In-person visit". We render the transport hint in parentheses for
// video/audio because the patient may need to know which platform they
// used (relevant for refund / fraud disputes).
// ---------------------------------------------------------------------
async function loadConsultModeForSession(sessionId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("consultation_sessions")
    .select("modality")
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !data) return null;
  const m = (data as { modality?: string | null }).modality;
  if (m === "video") return "Video (Daily.co)";
  if (m === "audio") return "Audio (Daily.co)";
  if (m === "in_person") return "In-person visit";
  return m ?? null;
}

// ---------------------------------------------------------------------
// Lab tests + item loaders (v3)
//
// Lab tests live in the prescription_lab_tests table (M026). We load
// them ordered by `ordinal` ascending. The composition for each item
// comes via a join from prescription_items.medicine_sku into the
// medicine_catalog (M025) — nullable, present only when the doctor
// picked the drug from autocomplete rather than free-text.
// ---------------------------------------------------------------------
type RxItemWithCompositionRow = {
  ordinal: number;
  drug_name: string;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
  medicine: { composition: string | null } | null;
};

async function loadRxItemsForPdf(
  rxId: string,
): Promise<RxItemWithCompositionRow[]> {
  const { data, error } = await supabaseAdmin
    .from("prescription_items")
    .select(
      "ordinal, drug_name, dose, frequency, duration, instructions, medicine:medicine_catalog(composition)",
    )
    .eq("prescription_id", rxId)
    .order("ordinal", { ascending: true });
  if (error) {
    throw new Error(`Could not load items: ${error.message}`);
  }
  return (data ?? []) as unknown as RxItemWithCompositionRow[];
}

type RxLabTestRow = {
  ordinal: number;
  test_name: string;
  instructions: string | null;
};

async function loadRxLabTestsForPdf(rxId: string): Promise<RxLabTestRow[]> {
  const { data, error } = await supabaseAdmin
    .from("prescription_lab_tests")
    .select("ordinal, test_name, instructions")
    .eq("prescription_id", rxId)
    .order("ordinal", { ascending: true });
  if (error) {
    // Not found is fine — older Rx may predate M026. Surface other errors.
    if (error.code === "PGRST116") return [];
    throw new Error(`Could not load lab tests: ${error.message}`);
  }
  return (data ?? []) as unknown as RxLabTestRow[];
}

// Drawer hydration loader — joins lab_tests (M027) so the composer
// can re-render catalog metadata (category, code, price) for previously
// saved rows. The PDF renderer uses loadRxLabTestsForPdf above and
// stays test_name + instructions only.
type RxLabTestForDrawerRow = {
  ordinal: number;
  test_name: string;
  instructions: string | null;
  lab_test_id: string | null;
  catalog_code: string | null;
  catalog_category: string | null;
  catalog_method: string | null;
  catalog_sample: string | null;
  catalog_tat: string | null;
  catalog_price_paise: number | null;
};

async function loadRxLabTestsForDrawer(
  rxId: string,
): Promise<RxLabTestForDrawerRow[]> {
  const { data, error } = await supabaseAdmin
    .from("prescription_lab_tests")
    .select(
      "ordinal, test_name, instructions, lab_test_id, catalog:lab_tests(code, category, method, sample, tat, price_paise)",
    )
    .eq("prescription_id", rxId)
    .order("ordinal", { ascending: true });
  if (error) {
    if (error.code === "PGRST116") return [];
    throw new Error(`Could not load lab tests: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as Array<{
    ordinal: number;
    test_name: string;
    instructions: string | null;
    lab_test_id: string | null;
    catalog: {
      code: string | null;
      category: string | null;
      method: string | null;
      sample: string | null;
      tat: string | null;
      price_paise: number | null;
    } | null;
  }>;
  return rows.map((r) => ({
    ordinal: r.ordinal,
    test_name: r.test_name,
    instructions: r.instructions,
    lab_test_id: r.lab_test_id,
    catalog_code: r.catalog?.code ?? null,
    catalog_category: r.catalog?.category ?? null,
    catalog_method: r.catalog?.method ?? null,
    catalog_sample: r.catalog?.sample ?? null,
    catalog_tat: r.catalog?.tat ?? null,
    catalog_price_paise: r.catalog?.price_paise ?? null,
  }));
}

// =====================================================================
// createDraftPrescription
//
// Opens the composer for a given consultation session. Idempotent: if
// the doctor already has a non-voided/non-superseded draft on this
// session, returns the existing prescription_id (no fresh next_code
// burn). Otherwise allocates a new prescription_code via next_code and
// inserts a row with version=1, status=draft.
//
// Redirects on success to /doctor/sessions/[session]/prescribe — the
// composer URL is keyed by session because there's always at most one
// open draft per (session, doctor), and the route resolves the row.
// =====================================================================
export async function createDraftPrescription(formData: FormData): Promise<void> {
  const session_id = reqStr(formData, "session_id");
  const { doctor, session } = await assertSessionOwnership(session_id);

  // Look for an existing open draft on this session (by this doctor).
  // We only check status='draft' — a sent Rx is its own surface
  // (amend / void), not a continuation of the composer.
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from("prescriptions")
    .select("id")
    .eq("session_id", session.id)
    .eq("doctor_id", doctor.id)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingErr) {
    throw new Error(`Could not check existing drafts: ${existingErr.message}`);
  }
  if (existing) {
    // Idempotent path — reuse the open draft.
    revalidatePath(`/doctor/sessions/${session.id}/prescribe`);
    redirect(`/doctor/sessions/${session.id}/prescribe`);
  }

  // Fresh draft. Allocate a new prescription_code via the SECURITY
  // DEFINER counter function (uses service-role privileges to increment
  // code_counters atomically — same fn used for booking / doctor codes).
  const { data: codeData, error: codeErr } = await supabaseAdmin.rpc("next_code", {
    p_type: "prescription",
  });
  if (codeErr || !codeData) {
    throw new Error(
      `Could not allocate Rx code: ${codeErr?.message ?? "unknown"}`,
    );
  }
  const prescriptionCode = String(codeData);

  // Snapshot the patient name into the draft. Age / sex / weight start
  // null and are filled in by the composer.
  const patient = await loadBookingPatientSnapshot(session.booking_id);

  const { error: insertErr } = await supabaseAdmin.from("prescriptions").insert({
    prescription_code: prescriptionCode,
    version: 1,
    session_id: session.id,
    booking_id: session.booking_id,
    doctor_id: doctor.id,
    created_by_doctor_id: doctor.id,
    patient_name: patient.patient_name,
    status: "draft",
  });
  if (insertErr) {
    throw new Error(`Could not create Rx draft: ${insertErr.message}`);
  }

  revalidatePath(`/doctor/sessions/${session.id}/prescribe`);
  redirect(`/doctor/sessions/${session.id}/prescribe`);
}

// =====================================================================
// updatePrescriptionDraft
//
// Save composer state — header fields + item list. Only works on
// status='draft' rows; sending or amending is via send/amend below.
// Items are replaced wholesale on every save (delete-then-insert in a
// single supabase RPC equivalent — but no actual RPC, so we do two
// queries in sequence).
//
// The items are submitted as a JSON-encoded array under "items_json"
// (the composer client serialises its row state). We validate shape
// here so a malformed item can't sneak past the CHECK constraints.
// =====================================================================
type DraftItemInput = {
  drug_name: string;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
  /** Optional FK into medicine_catalog (M025/M026). When present the
   *  composition is rendered under the drug name on the v3 PDF. */
  medicine_sku: number | null;
};

function parseItemsJson(raw: string): DraftItemInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Items list is malformed (could not parse).");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Items list must be an array.");
  }
  return parsed.map((row, i): DraftItemInput => {
    if (!row || typeof row !== "object") {
      throw new Error(`Item ${i + 1}: must be an object.`);
    }
    const r = row as Record<string, unknown>;
    const drug = typeof r.drug_name === "string" ? r.drug_name.trim() : "";
    if (!drug) {
      throw new Error(`Item ${i + 1}: drug name is required.`);
    }
    const opt = (k: string): string | null => {
      const v = r[k];
      if (typeof v !== "string") return null;
      const t = v.trim();
      return t === "" ? null : t;
    };
    let medicine_sku: number | null = null;
    if (r.medicine_sku != null && r.medicine_sku !== "") {
      const n = Number(r.medicine_sku);
      if (Number.isFinite(n) && Number.isInteger(n) && n > 0) {
        medicine_sku = n;
      }
    }
    return {
      drug_name: drug,
      dose: opt("dose"),
      frequency: opt("frequency"),
      duration: opt("duration"),
      instructions: opt("instructions"),
      medicine_sku,
    };
  });
}

// ---------------------------------------------------------------------
// Lab-tests JSON parser
//
// Mirror of parseItemsJson for the v3 "Investigations Advised" block.
// Free-text test names (Q4 from v3 sign-off — phase-2 can swap in a
// catalog FK without breaking these rows).
// ---------------------------------------------------------------------
type DraftLabTestInput = {
  test_name: string;
  instructions: string | null;
  /** Optional UUID FK into public.lab_tests (M027). When the doctor
   *  picks from the LabTestAutocomplete dropdown, the catalog row's id
   *  rides through here so the FK can land on prescription_lab_tests.
   *  Free-text rows (typed test names not in the catalog) leave this
   *  null — preserves the M026 free-text fallback. */
  lab_test_id: string | null;
};

const UUID_RE_LOCAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseLabTestsJson(raw: string): DraftLabTestInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Lab tests list is malformed (could not parse).");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Lab tests list must be an array.");
  }
  return parsed.map((row, i): DraftLabTestInput => {
    if (!row || typeof row !== "object") {
      throw new Error(`Lab test ${i + 1}: must be an object.`);
    }
    const r = row as Record<string, unknown>;
    const name = typeof r.test_name === "string" ? r.test_name.trim() : "";
    if (!name) {
      throw new Error(`Lab test ${i + 1}: test name is required.`);
    }
    const instrRaw = typeof r.instructions === "string" ? r.instructions.trim() : "";
    let lab_test_id: string | null = null;
    if (r.lab_test_id != null && r.lab_test_id !== "") {
      if (typeof r.lab_test_id !== "string" || !UUID_RE_LOCAL.test(r.lab_test_id)) {
        throw new Error(`Lab test ${i + 1}: lab_test_id is not a valid UUID.`);
      }
      lab_test_id = r.lab_test_id;
    }
    return {
      test_name: name,
      instructions: instrRaw === "" ? null : instrRaw,
      lab_test_id,
    };
  });
}

export async function updatePrescriptionDraft(formData: FormData): Promise<void> {
  const prescription_id = reqStr(formData, "prescription_id");
  const { rx } = await assertPrescriptionOwnership(prescription_id);
  if (rx.status !== "draft") {
    throw new Error(
      `This prescription is ${rx.status} and can no longer be edited. Use amend instead.`,
    );
  }

  const patient_name = reqStr(formData, "patient_name");
  const patient_age = intOrNull(formData, "patient_age");
  if (patient_age != null && (patient_age < 0 || patient_age > 130)) {
    throw new Error("Patient age must be between 0 and 130.");
  }
  const patient_sex_raw = str(formData, "patient_sex");
  let patient_sex: "M" | "F" | "O" | "U" | null = null;
  if (patient_sex_raw) {
    if (!["M", "F", "O", "U"].includes(patient_sex_raw)) {
      throw new Error("Patient sex must be M / F / O / U.");
    }
    patient_sex = patient_sex_raw as "M" | "F" | "O" | "U";
  }
  const patient_weight_kg = numOrNull(formData, "patient_weight_kg");
  if (patient_weight_kg != null && (patient_weight_kg <= 0 || patient_weight_kg >= 500)) {
    throw new Error("Patient weight must be greater than 0 and less than 500 kg.");
  }

  // M026 vitals (all optional). Range checks here mirror the CHECK
  // constraints in M026 so a bad value fails server-side rather than
  // throwing a 23514 from Postgres.
  const bp_sys = intOrNull(formData, "bp_sys");
  if (bp_sys != null && (bp_sys < 50 || bp_sys > 250)) {
    throw new Error("Systolic BP must be between 50 and 250 mmHg.");
  }
  const bp_dia = intOrNull(formData, "bp_dia");
  if (bp_dia != null && (bp_dia < 30 || bp_dia > 160)) {
    throw new Error("Diastolic BP must be between 30 and 160 mmHg.");
  }
  const pulse_bpm = intOrNull(formData, "pulse_bpm");
  if (pulse_bpm != null && (pulse_bpm < 30 || pulse_bpm > 220)) {
    throw new Error("Pulse must be between 30 and 220 bpm.");
  }
  const spo2_pct = intOrNull(formData, "spo2_pct");
  if (spo2_pct != null && (spo2_pct < 50 || spo2_pct > 100)) {
    throw new Error("SpO2 must be between 50 and 100 %.");
  }
  const temp_c = numOrNull(formData, "temp_c");
  if (temp_c != null && (temp_c < 30 || temp_c > 45)) {
    throw new Error("Temperature must be between 30 and 45 °C.");
  }
  const height_cm = numOrNull(formData, "height_cm");
  if (height_cm != null && (height_cm < 30 || height_cm > 250)) {
    throw new Error("Height must be between 30 and 250 cm.");
  }

  const itemsRaw = str(formData, "items_json") ?? "[]";
  const items = parseItemsJson(itemsRaw);

  // lab_tests_json is optional — the legacy composer surface doesn't
  // submit it; the v3 drawer surface does.
  const labTestsRaw = str(formData, "lab_tests_json");
  const labTests = labTestsRaw ? parseLabTestsJson(labTestsRaw) : null;

  // Update header fields.
  const { error: updateErr } = await supabaseAdmin
    .from("prescriptions")
    .update({
      patient_name,
      patient_age,
      patient_sex,
      patient_weight_kg,
      bp_sys,
      bp_dia,
      pulse_bpm,
      spo2_pct,
      temp_c,
      height_cm,
      chief_complaint: str(formData, "chief_complaint"),
      provisional_diagnosis: str(formData, "provisional_diagnosis"),
      general_advice: str(formData, "general_advice"),
      follow_up_advice: str(formData, "follow_up_advice"),
    })
    .eq("id", rx.id);
  if (updateErr) {
    throw new Error(`Could not save draft: ${updateErr.message}`);
  }

  // Replace items wholesale. We delete + re-insert (not upsert) because
  // ordinals are simpler to reason about as 1..N every save. The DELETE
  // policy on prescription_items only allows ops (and service role)
  // delete; the service-role client used here bypasses RLS.
  const { error: deleteErr } = await supabaseAdmin
    .from("prescription_items")
    .delete()
    .eq("prescription_id", rx.id);
  if (deleteErr) {
    throw new Error(`Could not clear items: ${deleteErr.message}`);
  }
  if (items.length > 0) {
    const rows = items.map((it, idx) => ({
      prescription_id: rx.id,
      ordinal: idx + 1,
      drug_name: it.drug_name,
      dose: it.dose,
      frequency: it.frequency,
      duration: it.duration,
      instructions: it.instructions,
      medicine_sku: it.medicine_sku,
    }));
    const { error: insertErr } = await supabaseAdmin
      .from("prescription_items")
      .insert(rows);
    if (insertErr) {
      throw new Error(`Could not save items: ${insertErr.message}`);
    }
  }

  // Replace lab tests wholesale (same pattern as items). Skipped when
  // lab_tests_json wasn't submitted — keeps the legacy composer route
  // backwards-compatible.
  if (labTests != null) {
    const { error: labDelErr } = await supabaseAdmin
      .from("prescription_lab_tests")
      .delete()
      .eq("prescription_id", rx.id);
    if (labDelErr) {
      throw new Error(`Could not clear lab tests: ${labDelErr.message}`);
    }
    if (labTests.length > 0) {
      const rows = labTests.map((t, idx) => ({
        prescription_id: rx.id,
        ordinal: idx + 1,
        test_name: t.test_name,
        instructions: t.instructions,
        lab_test_id: t.lab_test_id, // M027: catalog FK, nullable for free-text rows
      }));
      const { error: labInsErr } = await supabaseAdmin
        .from("prescription_lab_tests")
        .insert(rows);
      if (labInsErr) {
        throw new Error(`Could not save lab tests: ${labInsErr.message}`);
      }
    }
  }

  revalidatePath(`/doctor/sessions/${rx.session_id}/prescribe`);
}

// =====================================================================
// sendPrescription
//
// Final step: lock the draft, render the PDF, upload it to the
// prescriptions bucket, mint a patient-view token, then deliver via
// Rampwin WhatsApp.
//
// Failure semantics:
//   - PDF render / upload failure → row stays draft, action returns error
//   - Rampwin delivery failure → row still flips to 'sent' (PDF is
//       saved + token minted) so ops can manually deliver the
//       /rx/<token> URL from /ops/prescriptions/[rx_code]. We mark
//       whatsapp_sent_at = NULL so ops sees "delivery pending".
//
// Pre-conditions:
//   - rx.status = 'draft'
//   - doctor.signature_image_url is non-null (we refuse to issue an
//       unsigned Rx — that's an MCI / NMC requirement)
//   - at least one prescription_items row exists OR there's free-text
//       advice (a blank Rx is meaningless)
// =====================================================================
export async function sendPrescription(
  formData: FormData,
): Promise<RxActionResult<{ prescription_code: string; rx_url: string; whatsapp_sent: boolean }>> {
  const prescription_id = reqStr(formData, "prescription_id");

  try {
    const { doctor, rx } = await assertPrescriptionOwnership(prescription_id);
    if (rx.status !== "draft") {
      return {
        ok: false,
        error: `This prescription is ${rx.status} — only a draft can be sent.`,
      };
    }
    if (!doctor.registration_no || doctor.registration_no.trim() === "") {
      return {
        ok: false,
        error:
          "Your registration number isn't on file yet — ask ops to add it to your profile before issuing prescriptions.",
      };
    }

    // Re-load doctor with signature + stamp + issuing council because
    // getCurrentDoctor doesn't return them (avoiding bloat on every
    // page load). The stamp is optional (renders as a dashed-ring
    // placeholder when null per F2 in the v3 brief).
    const { data: doctorExt, error: doctorExtErr } = await supabaseAdmin
      .from("doctors")
      .select("signature_image_url, stamp_image_url, issuing_council")
      .eq("id", doctor.id)
      .maybeSingle();
    if (doctorExtErr) {
      return { ok: false, error: `Could not check signature: ${doctorExtErr.message}` };
    }
    const signaturePath = (doctorExt as { signature_image_url: string | null } | null)?.signature_image_url;
    if (!signaturePath) {
      return {
        ok: false,
        error:
          "Your signature isn't on file yet — ask ops to upload it from your /ops/doctors profile before issuing prescriptions.",
      };
    }
    const stampPath = (doctorExt as { stamp_image_url: string | null } | null)?.stamp_image_url ?? null;
    const issuingCouncil = (doctorExt as { issuing_council: string | null } | null)?.issuing_council ?? null;

    // Load items (with composition via the medicine_catalog FK) + lab tests.
    let items: RxItemWithCompositionRow[];
    let labTests: RxLabTestRow[];
    try {
      items = await loadRxItemsForPdf(rx.id);
      labTests = await loadRxLabTestsForPdf(rx.id);
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Could not load Rx body.",
      };
    }
    const hasContent =
      items.length > 0 ||
      labTests.length > 0 ||
      !!rx.chief_complaint ||
      !!rx.provisional_diagnosis ||
      !!rx.general_advice ||
      !!rx.follow_up_advice;
    if (!hasContent) {
      return {
        ok: false,
        error:
          "This prescription is empty — add at least one medication, lab test, or advice before sending.",
      };
    }

    // Patient phone (for WhatsApp delivery) + patient_code + booking_code
    // (for the v3 Patient ID and Booking ID strip).
    const patient = await loadBookingPatientSnapshot(rx.booking_id);
    if (!patient.patient_phone) {
      // Allow sending anyway — ops can deliver out-of-band.
      console.warn(`[sendPrescription] No patient phone for booking ${rx.booking_id}; WhatsApp send will be skipped.`);
    }

    // Consult mode (for the v3 "Consult mode" identity strip).
    const consultMode = await loadConsultModeForSession(rx.session_id);

    // ---- Render PDF ----
    const sentAtIso = new Date().toISOString();
    const pdfData: PrescriptionPdfData = {
      prescription_code: rx.prescription_code,
      version: rx.version,
      sent_at_iso: sentAtIso,
      doctor_full_name: doctor.full_name,
      doctor_qualification: doctor.qualification,
      doctor_registration_no: doctor.registration_no,
      doctor_issuing_council: issuingCouncil,
      patient_name: rx.patient_name,
      patient_age: rx.patient_age,
      patient_sex: rx.patient_sex,
      patient_weight_kg: rx.patient_weight_kg,
      patient_code: patient.patient_code,
      booking_code: patient.booking_code,
      consult_mode: consultMode,
      bp_sys: rx.bp_sys,
      bp_dia: rx.bp_dia,
      pulse_bpm: rx.pulse_bpm,
      spo2_pct: rx.spo2_pct,
      temp_c: rx.temp_c,
      height_cm: rx.height_cm,
      chief_complaint: rx.chief_complaint,
      provisional_diagnosis: rx.provisional_diagnosis,
      items: items.map((it) => ({
        ordinal: it.ordinal,
        drug_name: it.drug_name,
        composition: it.medicine?.composition ?? null,
        dose: it.dose,
        frequency: it.frequency,
        duration: it.duration,
        instructions: it.instructions,
      })),
      lab_tests: labTests.map((t) => ({
        ordinal: t.ordinal,
        test_name: t.test_name,
        instructions: t.instructions,
      })),
      general_advice: rx.general_advice,
      follow_up_advice: rx.follow_up_advice,
      qr_data_url: null, // generated inside renderPrescriptionPdf
    };

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await renderPrescriptionPdf({
        data: pdfData,
        signature: { kind: "storagePath", path: signaturePath },
        stamp: stampPath
          ? { kind: "storagePath", path: stampPath }
          : { kind: "placeholder" },
      });
    } catch (e) {
      console.error("[sendPrescription] PDF render failed:", e);
      return {
        ok: false,
        error: `PDF render failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    // ---- Upload PDF ----
    const storagePath = `${rx.prescription_code}/v${rx.version}.pdf`;
    const { error: uploadErr } = await supabaseAdmin.storage
      .from(PRESCRIPTIONS_BUCKET)
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true, // re-send after a Rampwin failure overwrites cleanly
      });
    if (uploadErr) {
      console.error("[sendPrescription] PDF upload failed:", uploadErr);
      return {
        ok: false,
        error: `PDF upload failed: ${uploadErr.message}`,
      };
    }

    // ---- Mint patient-view token + commit row to 'sent' ----
    const patientViewToken = generateRxPatientViewToken();
    const { error: commitErr } = await supabaseAdmin
      .from("prescriptions")
      .update({
        status: "sent",
        sent_at: sentAtIso,
        pdf_storage_path: storagePath,
        patient_view_token: patientViewToken,
      })
      .eq("id", rx.id)
      .eq("status", "draft"); // optimistic — if already flipped, abort
    if (commitErr) {
      console.error("[sendPrescription] commit-to-sent failed:", commitErr);
      return {
        ok: false,
        error: `Could not commit Rx: ${commitErr.message}`,
      };
    }

    const rxUrl = `${(
      process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://sanocare.in"
    ).replace(/\/+$/, "")}/rx/${patientViewToken}`;

    // ---- WhatsApp deliver ----
    let whatsappSent = false;
    if (patient.patient_phone) {
      // For document-header mode, sign a 1-hour URL Meta can fetch
      // during message render. We MUST use the same env-parse helper
      // as rampwin.ts — if this side and the sender disagree (e.g. on
      // trailing whitespace in the env var), sendRxLink throws
      // "signedPdfUrl was not supplied" and every Rx fails.
      let signedPdfUrl: string | null = null;
      if (isRxDocumentHeaderEnabled()) {
        const { data: signed, error: signErr } = await supabaseAdmin.storage
          .from(PRESCRIPTIONS_BUCKET)
          .createSignedUrl(storagePath, 60 * 60);
        if (signErr || !signed?.signedUrl) {
          console.error("[sendPrescription] could not sign PDF for Meta:", signErr);
        } else {
          signedPdfUrl = signed.signedUrl;
        }
      }

      try {
        const sendResult = await sendRxLink({
          phone: patient.patient_phone,
          patientName: rx.patient_name,
          doctorName: doctor.full_name,
          patientViewToken,
          signedPdfUrl,
          prescriptionCode: rx.prescription_code,
        });
        await supabaseAdmin
          .from("prescriptions")
          .update({
            whatsapp_sent_at: new Date().toISOString(),
            whatsapp_message_id: sendResult.providerMessageId ?? null,
          })
          .eq("id", rx.id);
        whatsappSent = true;
      } catch (e) {
        if (e instanceof RampwinRxDeliveryError) {
          console.warn(
            `[sendPrescription] WhatsApp delivery failed for ${rx.prescription_code}; ops can deliver ${rxUrl} manually. Cause:`,
            e.message,
          );
        } else {
          console.error("[sendPrescription] unexpected delivery error:", e);
        }
        // Leave whatsappSent=false; the success result tells the UI.
      }
    }

    revalidatePath(`/doctor/sessions/${rx.session_id}/prescribe`);
    revalidatePath(`/doctor/prescriptions`);
    revalidatePath(`/doctor/prescriptions/${rx.prescription_code}`);
    revalidatePath(`/ops/prescriptions`);
    revalidatePath(`/ops/prescriptions/${rx.prescription_code}`);
    revalidatePath(`/ops/bookings/${rx.booking_id}`);

    return {
      ok: true,
      data: {
        prescription_code: rx.prescription_code,
        rx_url: rxUrl,
        whatsapp_sent: whatsappSent,
      },
    };
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not send prescription.",
    };
  }
}

// =====================================================================
// amendPrescription
//
// Fork v(N+1) from a sent (or already-superseded) Rx. Per the Q1
// design:
//   - v(N+1).prescription_code = parent_head.prescription_code (INHERITED)
//   - v(N+1).version = parent_head.version + 1
//   - status = 'draft'
//   - patient_view_token / pdf_storage_path / sent_at / whatsapp_*
//       all start NULL
//   - we deep-copy parent_head's items
//   - parent_head.superseded_by + parent_head.status DO NOT flip yet —
//       they flip on send() of the new version (so an abandoned amend
//       draft never orphans the live Rx)
//
// We walk to the head of the chain first (if the user clicks Amend on
// an already-superseded row, we want to amend the head).
// =====================================================================
export async function amendPrescription(
  formData: FormData,
): Promise<RxActionResult<{ new_prescription_id: string; new_version: number }>> {
  const parent_id = reqStr(formData, "prescription_id");

  try {
    const { doctor, rx: parent } = await assertPrescriptionOwnership(parent_id);
    if (parent.status === "draft") {
      return {
        ok: false,
        error: "This is already a draft — edit it directly instead of amending.",
      };
    }
    if (parent.status === "voided") {
      return {
        ok: false,
        error: "A voided prescription cannot be amended. Start a new one for this consultation.",
      };
    }

    // Walk to the head if parent is already superseded.
    let head = parent;
    while (head.superseded_by) {
      const { data: next, error } = await supabaseAdmin
        .from("prescriptions")
        .select(RX_SELECT_COLS)
        .eq("id", head.superseded_by)
        .maybeSingle();
      if (error || !next) {
        return {
          ok: false,
          error: `Could not walk the amend chain: ${error?.message ?? "missing successor"}`,
        };
      }
      head = next as PrescriptionRow;
    }
    if (head.doctor_id !== doctor.id) {
      return {
        ok: false,
        error:
          "The current head of this prescription chain was written by another doctor; ask them to amend it.",
      };
    }
    if (head.status === "voided") {
      return {
        ok: false,
        error: "The head of this chain is voided — amendment isn't allowed.",
      };
    }

    // Insert v(N+1) inheriting code from the head. We copy vitals,
    // chief complaint, diagnosis, and advice fields so the amend draft
    // starts as an editable mirror of the head; the doctor can then
    // change whichever fields the correction touches.
    const newVersion = head.version + 1;
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("prescriptions")
      .insert({
        prescription_code: head.prescription_code,
        version: newVersion,
        session_id: head.session_id,
        booking_id: head.booking_id,
        doctor_id: doctor.id,
        created_by_doctor_id: doctor.id,
        patient_name: head.patient_name,
        patient_age: head.patient_age,
        patient_sex: head.patient_sex,
        patient_weight_kg: head.patient_weight_kg,
        chief_complaint: head.chief_complaint,
        provisional_diagnosis: head.provisional_diagnosis,
        general_advice: head.general_advice,
        follow_up_advice: head.follow_up_advice,
        // M026 vitals — copy across so amend doesn't silently lose them.
        bp_sys: head.bp_sys,
        bp_dia: head.bp_dia,
        pulse_bpm: head.pulse_bpm,
        spo2_pct: head.spo2_pct,
        temp_c: head.temp_c,
        height_cm: head.height_cm,
        status: "draft",
      })
      .select("id")
      .single();
    if (insertErr || !inserted) {
      // The composite UNIQUE (prescription_code, version) constraint is
      // the DB-level guard against a concurrent amend creating the same
      // (code, version) twice.
      return {
        ok: false,
        error: `Could not create amend draft: ${insertErr?.message ?? "unknown"}`,
      };
    }

    const newRxId = (inserted as { id: string }).id;

    // Deep-copy items (preserving medicine_sku so composition stays linked).
    const { data: parentItems, error: itemsErr } = await supabaseAdmin
      .from("prescription_items")
      .select("ordinal, drug_name, dose, frequency, duration, instructions, medicine_sku")
      .eq("prescription_id", head.id)
      .order("ordinal", { ascending: true });
    if (itemsErr) {
      // Best-effort — leave the new row item-less if the copy fails.
      // The composer will surface "no items" and the doctor can re-add.
      console.error("[amendPrescription] could not copy items:", itemsErr);
    } else if (parentItems && parentItems.length > 0) {
      const copyRows = parentItems.map((it) => ({
        prescription_id: newRxId,
        ordinal: (it as { ordinal: number }).ordinal,
        drug_name: (it as { drug_name: string }).drug_name,
        dose: (it as { dose: string | null }).dose,
        frequency: (it as { frequency: string | null }).frequency,
        duration: (it as { duration: string | null }).duration,
        instructions: (it as { instructions: string | null }).instructions,
        medicine_sku: (it as { medicine_sku: number | null }).medicine_sku ?? null,
      }));
      const { error: copyErr } = await supabaseAdmin
        .from("prescription_items")
        .insert(copyRows);
      if (copyErr) {
        console.error("[amendPrescription] item copy insert failed:", copyErr);
      }
    }

    // Deep-copy lab tests (M026 + M027 catalog FK).
    const { data: parentLabTests, error: labErr } = await supabaseAdmin
      .from("prescription_lab_tests")
      .select("ordinal, test_name, instructions, lab_test_id")
      .eq("prescription_id", head.id)
      .order("ordinal", { ascending: true });
    if (labErr) {
      console.error("[amendPrescription] could not copy lab tests:", labErr);
    } else if (parentLabTests && parentLabTests.length > 0) {
      const copyRows = parentLabTests.map((t) => ({
        prescription_id: newRxId,
        ordinal: (t as { ordinal: number }).ordinal,
        test_name: (t as { test_name: string }).test_name,
        instructions: (t as { instructions: string | null }).instructions,
        lab_test_id: (t as { lab_test_id: string | null }).lab_test_id ?? null,
      }));
      const { error: copyErr } = await supabaseAdmin
        .from("prescription_lab_tests")
        .insert(copyRows);
      if (copyErr) {
        console.error("[amendPrescription] lab-test copy insert failed:", copyErr);
      }
    }

    revalidatePath(`/doctor/sessions/${head.session_id}/prescribe`);
    revalidatePath(`/doctor/prescriptions`);

    return {
      ok: true,
      data: {
        new_prescription_id: newRxId,
        new_version: newVersion,
      },
    };
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not amend prescription.",
    };
  }
}

// =====================================================================
// voidPrescription
//
// Kill a sent Rx. Sets status='voided', voided_at=now, void_reason=...,
// and CLEARS patient_view_token so the /rx/<token> route immediately
// stops serving the PDF. The PDF object in storage is left in place
// (medical-record retention) — only access is revoked.
//
// Allowed when: status='sent' or 'superseded'. Drafts use delete-draft
// (not implemented in this build — drafts are just abandoned).
//
// On a 'sent' row: that's the patient-facing one, so voiding it ends
// access entirely.
// On a 'superseded' row: voiding it removes the audit trail's tail
// pointer to it — but the live head is unaffected. We allow this
// because regulatory bodies sometimes require deleting an old version
// after a correction (the head's audit trail keeps superseded_by but
// returns nothing on /rx/<token> for that earlier version anyway —
// voiding is belt-and-suspenders).
// =====================================================================
export async function voidPrescription(
  formData: FormData,
): Promise<RxActionResult<{ prescription_code: string; voided_version: number }>> {
  const prescription_id = reqStr(formData, "prescription_id");
  const reason = reqStr(formData, "void_reason");
  if (reason.length < 4) {
    return {
      ok: false,
      error: "Reason must be at least 4 characters — a clear audit note matters.",
    };
  }

  try {
    const { rx } = await assertPrescriptionOwnership(prescription_id);
    if (rx.status !== "sent" && rx.status !== "superseded") {
      return {
        ok: false,
        error: `Cannot void a ${rx.status} prescription.`,
      };
    }

    const { error: updateErr } = await supabaseAdmin
      .from("prescriptions")
      .update({
        status: "voided",
        voided_at: new Date().toISOString(),
        void_reason: reason,
        // Revoke patient access immediately.
        patient_view_token: null,
      })
      .eq("id", rx.id);
    if (updateErr) {
      return { ok: false, error: `Could not void prescription: ${updateErr.message}` };
    }

    revalidatePath(`/doctor/prescriptions`);
    revalidatePath(`/doctor/prescriptions/${rx.prescription_code}`);
    revalidatePath(`/ops/prescriptions`);
    revalidatePath(`/ops/prescriptions/${rx.prescription_code}`);
    revalidatePath(`/ops/bookings/${rx.booking_id}`);

    return {
      ok: true,
      data: {
        prescription_code: rx.prescription_code,
        voided_version: rx.version,
      },
    };
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not void prescription.",
    };
  }
}

// =====================================================================
// v3 drawer-composer support actions
//
// These power the in-call Rx drawer (DutyRoomEmbed → RxComposerDrawer).
// They differ from createDraftPrescription / updatePrescriptionDraft in
// that they DO NOT redirect — they return data the client can render
// inside the drawer modal.
//
// A1 enforcement: every action calls getCurrentDoctor() first and
// re-asserts session/prescription ownership before any mutation.
// =====================================================================

export type ActiveRxSessionInfo = {
  session_id: string;
  booking_id: string;
  booking_code: string | null;
  patient_name: string;
  patient_code: string | null;
  joined_at: string; // ISO of when the patient last joined
};

/**
 * Resolve the doctor's currently-active consult for the in-call Rx
 * drawer. Per Q2 (v3 sign-off): "most-recent-waiting-with-joined_at"
 * — we look for the patient who joined this doctor's Duty Room most
 * recently, scoped to the last few hours so a stale yesterday-session
 * doesn't surface.
 *
 * Returns null when no patient has joined in the recent window —
 * the drawer shows a "No patient in consult yet" empty state.
 */
export async function findActiveRxSessionForDoctor(): Promise<ActiveRxSessionInfo | null> {
  const doctor = await getCurrentDoctor();

  // 8-hour recency window. A typical Sanocare consult is 15-30 min;
  // an 8-hour bound rules out a session from yesterday morning that's
  // still got 'in_call' status by mistake.
  const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("consultation_participants")
    .select(
      "joined_at, session:consultation_sessions!session_id(id, booking_id, doctor_id, scheduled_at, status)",
    )
    .eq("role", "patient")
    .not("joined_at", "is", null)
    .gte("joined_at", eightHoursAgo)
    .order("joined_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(`Could not resolve active session: ${error.message}`);
  }

  // Filter client-side for the doctor's sessions (the embed shape
  // means we can't filter session.doctor_id directly in the .eq()
  // call). 20 rows is enough headroom — a single doctor in an 8-hour
  // window won't have more than 20 patient joins.
  const rows = (data ?? []) as unknown as Array<{
    joined_at: string;
    session: {
      id: string;
      booking_id: string;
      doctor_id: string;
      scheduled_at: string;
      status: string;
    } | null;
  }>;

  const mine = rows.find((r) => r.session?.doctor_id === doctor.id);
  if (!mine || !mine.session) return null;

  // Resolve patient identity off the booking.
  const patient = await loadBookingPatientSnapshot(mine.session.booking_id);

  return {
    session_id: mine.session.id,
    booking_id: mine.session.booking_id,
    booking_code: patient.booking_code,
    patient_name: patient.patient_name,
    patient_code: patient.patient_code,
    joined_at: mine.joined_at,
  };
}

// ---------------------------------------------------------------------
// Drawer composer initial state
//
// The drawer needs a single round-trip on open: (a) the prescription_id
// (created-or-reused for the active session), and (b) the current draft
// state — header fields + vitals + items + lab tests — so the form
// hydrates with whatever was last saved.
// ---------------------------------------------------------------------
export type DrawerComposerInitial = {
  prescription_id: string;
  prescription_code: string;
  version: number;
  patient_name: string;
  patient_age: number | null;
  patient_sex: "M" | "F" | "O" | "U" | null;
  patient_weight_kg: number | null;
  bp_sys: number | null;
  bp_dia: number | null;
  pulse_bpm: number | null;
  spo2_pct: number | null;
  temp_c: number | null;
  height_cm: number | null;
  chief_complaint: string | null;
  provisional_diagnosis: string | null;
  general_advice: string | null;
  follow_up_advice: string | null;
  items: Array<{
    ordinal: number;
    drug_name: string;
    dose: string | null;
    frequency: string | null;
    duration: string | null;
    instructions: string | null;
    medicine_sku: number | null;
    composition: string | null;
  }>;
  lab_tests: Array<{
    ordinal: number;
    test_name: string;
    instructions: string | null;
    /** M027: catalog FK (UUID) when the doctor picked from the
     *  LabTestAutocomplete; null for free-text rows. */
    lab_test_id: string | null;
    /** Catalog snapshot fields surfaced in the drawer composer so the
     *  doctor sees "Lipid Profile · Routine · ₹450" not just "Lipid".
     *  All null when lab_test_id is null. */
    catalog_code: string | null;
    catalog_category: string | null;
    catalog_method: string | null;
    catalog_sample: string | null;
    catalog_tat: string | null;
    catalog_price_paise: number | null;
  }>;
};

/**
 * Idempotent "open the drawer composer" entry point. Resolves or
 * creates the draft for the given session (no redirect), then loads
 * the current draft body and returns it for the drawer to hydrate.
 */
export async function ensureDraftForSession(
  formData: FormData,
): Promise<RxActionResult<DrawerComposerInitial>> {
  const session_id = reqStr(formData, "session_id");
  try {
    const { doctor, session } = await assertSessionOwnership(session_id);

    // Look for an existing open draft.
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("prescriptions")
      .select("id")
      .eq("session_id", session.id)
      .eq("doctor_id", doctor.id)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingErr) {
      return {
        ok: false,
        error: `Could not check existing drafts: ${existingErr.message}`,
      };
    }

    let prescriptionId: string;
    if (existing) {
      prescriptionId = (existing as { id: string }).id;
    } else {
      const { data: codeData, error: codeErr } = await supabaseAdmin.rpc(
        "next_code",
        { p_type: "prescription" },
      );
      if (codeErr || !codeData) {
        return {
          ok: false,
          error: `Could not allocate Rx code: ${codeErr?.message ?? "unknown"}`,
        };
      }
      const prescriptionCode = String(codeData);
      const patient = await loadBookingPatientSnapshot(session.booking_id);
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from("prescriptions")
        .insert({
          prescription_code: prescriptionCode,
          version: 1,
          session_id: session.id,
          booking_id: session.booking_id,
          doctor_id: doctor.id,
          created_by_doctor_id: doctor.id,
          patient_name: patient.patient_name,
          status: "draft",
        })
        .select("id")
        .single();
      if (insertErr || !inserted) {
        return {
          ok: false,
          error: `Could not create Rx draft: ${insertErr?.message ?? "unknown"}`,
        };
      }
      prescriptionId = (inserted as { id: string }).id;
    }

    // Now load the current head + items + lab tests for hydration.
    // labTests goes through the drawer-specific loader (joins lab_tests
    // catalog for category/code/price snapshot) — the PDF loader stays
    // test_name + instructions only.
    const { rx } = await assertPrescriptionOwnership(prescriptionId);
    const items = await loadRxItemsForPdf(rx.id);
    const labTests = await loadRxLabTestsForDrawer(rx.id);

    const initial: DrawerComposerInitial = {
      prescription_id: rx.id,
      prescription_code: rx.prescription_code,
      version: rx.version,
      patient_name: rx.patient_name,
      patient_age: rx.patient_age,
      patient_sex: rx.patient_sex,
      patient_weight_kg: rx.patient_weight_kg,
      bp_sys: rx.bp_sys,
      bp_dia: rx.bp_dia,
      pulse_bpm: rx.pulse_bpm,
      spo2_pct: rx.spo2_pct,
      temp_c: rx.temp_c,
      height_cm: rx.height_cm,
      chief_complaint: rx.chief_complaint,
      provisional_diagnosis: rx.provisional_diagnosis,
      general_advice: rx.general_advice,
      follow_up_advice: rx.follow_up_advice,
      items: items.map((it) => ({
        ordinal: it.ordinal,
        drug_name: it.drug_name,
        dose: it.dose,
        frequency: it.frequency,
        duration: it.duration,
        instructions: it.instructions,
        // The legacy items table doesn't carry medicine_sku here
        // because we read it through the medicine_catalog join. The
        // FK itself is preserved on the DB row — the drawer simply
        // doesn't re-derive it from this hydrated state. Subsequent
        // save() calls preserve medicine_sku only for newly-picked
        // items; legacy items round-trip without the FK rehydrated.
        medicine_sku: null,
        composition: it.medicine?.composition ?? null,
      })),
      lab_tests: labTests.map((t) => ({
        ordinal: t.ordinal,
        test_name: t.test_name,
        instructions: t.instructions,
        lab_test_id: t.lab_test_id,
        catalog_code: t.catalog_code,
        catalog_category: t.catalog_category,
        catalog_method: t.catalog_method,
        catalog_sample: t.catalog_sample,
        catalog_tat: t.catalog_tat,
        catalog_price_paise: t.catalog_price_paise,
      })),
    };

    return { ok: true, data: initial };
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not open Rx composer.",
    };
  }
}
