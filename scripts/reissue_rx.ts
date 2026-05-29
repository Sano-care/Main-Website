#!/usr/bin/env tsx
/**
 * scripts/reissue_rx.ts
 *
 * Re-render an existing prescription with the current PDF template and
 * overwrite the existing PDF object in the prescriptions/ Supabase
 * Storage bucket. Used to bring older prescriptions onto the latest
 * visual template (e.g. v1 → v3 after the C2-Rx v3 build) WITHOUT
 * bumping version, minting a new patient_view_token, or sending a new
 * WhatsApp.
 *
 * Usage:
 *   npx tsx scripts/reissue_rx.ts <PRESCRIPTION_CODE>
 *
 * Example:
 *   npx tsx scripts/reissue_rx.ts SAN-RX-00001
 *
 * What it does
 * ------------
 * 1. Looks up the prescriptions row by code (most recent version of
 *    the chain — i.e. status='sent' or 'superseded' with highest
 *    version).
 * 2. Loads the doctor (signature path, stamp path, issuing council).
 * 3. Loads items (with composition via medicine_catalog join) +
 *    lab tests + booking patient / customer code + consult modality.
 * 4. Renders a fresh PDF via @/lib/rx/pdf/renderPrescriptionPdf.
 * 5. Overwrites the existing pdf_storage_path in the prescriptions
 *    bucket (upsert: true). Patient_view_token, sent_at, WhatsApp
 *    delivery state — all preserved. Patient hitting /rx/<token>
 *    now downloads the freshly rendered PDF immediately. Cache-bust
 *    via ?v=<timestamp> in the URL if a CDN edge needs nudging.
 *
 * Required env vars (no .env auto-load — set via shell or dotenv-cli):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * A1 note: this script bypasses RLS via the service_role key. It does
 * NOT impersonate the doctor — it operates on the historical row. The
 * doctor_id and signature path are loaded straight from the row.
 */

import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------
// Env

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing env vars: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

// Sanity-check the service role key shape so we don't accidentally run
// this with the anon key (a known footgun: the role payload says
// 'anon' instead of 'service_role' so storage writes silently fail).
try {
  const payloadB64 = serviceRoleKey.split(".")[1] ?? "";
  const payload = JSON.parse(
    Buffer.from(payloadB64, "base64").toString("utf-8"),
  ) as { role?: string };
  if (payload.role !== "service_role") {
    console.error(
      `SUPABASE_SERVICE_ROLE_KEY decodes to role='${payload.role ?? "<missing>"}'; expected 'service_role'.`,
    );
    process.exit(1);
  }
} catch (e) {
  console.error("Could not decode SUPABASE_SERVICE_ROLE_KEY:", e);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------
// Resolve target

const rxCode = process.argv[2];
if (!rxCode) {
  console.error("Usage: npx tsx scripts/reissue_rx.ts <PRESCRIPTION_CODE>");
  console.error("Example: npx tsx scripts/reissue_rx.ts SAN-RX-00001");
  process.exit(1);
}

// ---------------------------------------------------------------------
// Bridge to the runtime renderer. We resolve via tsx (the script
// runner) which transpiles TS imports at runtime, so this works as a
// regular ESM import even though the renderer lives under src/lib/.
// We need the explicit `../src/...` path because tsx doesn't honor the
// @/* path alias defined in tsconfig.json.

import {
  renderPrescriptionPdf,
} from "../src/lib/rx/pdf/renderPrescriptionPdf";
import type {
  PrescriptionPdfData,
} from "../src/lib/rx/pdf/PrescriptionPdf";

// ---------------------------------------------------------------------
// Helpers

/**
 * Mirror of deriveSponsorLabel() in src/app/doctor/_actions/prescription.ts.
 * v5 renderer needs a sponsor_label string for the patient-info table;
 * if the booking row's column is null we fall back to the same heuristic
 * used at send time.
 */
function deriveSponsorLabel(
  explicit: string | null | undefined,
  payment_status: string | null | undefined,
  amount_paid: number | null | undefined,
): string {
  if (explicit && explicit.trim() !== "") return explicit;
  const amt = amount_paid ?? 0;
  if (payment_status === "CAPTURED" && amt > 0) return `Self Pay ₹${amt}`;
  if (amt === 0) return "Test";
  return "Self Pay";
}

async function main() {
  console.log(`[reissue_rx] Looking up Rx ${rxCode}...`);

  // Walk to the head of the version chain — highest `version` for the
  // given prescription_code, status in (sent, superseded). We reissue
  // ANY non-draft row; the script doesn't care about voided rows but
  // we'll allow them (regulatory historical re-render) and warn.
  const { data: chain, error: chainErr } = await supabase
    .from("prescriptions")
    .select(
      "id, prescription_code, version, status, doctor_id, session_id, booking_id, patient_view_token, pdf_storage_path, sent_at, patient_name, patient_age, patient_sex, patient_weight_kg, chief_complaint, provisional_diagnosis, general_advice, follow_up_advice, bp_sys, bp_dia, pulse_bpm, spo2_pct, temp_c, height_cm, past_medical_history, presenting_complaints_duration",
    )
    .eq("prescription_code", rxCode)
    .order("version", { ascending: false });

  if (chainErr) {
    console.error(`Could not load Rx chain: ${chainErr.message}`);
    process.exit(1);
  }
  if (!chain || chain.length === 0) {
    console.error(`No prescription found with code ${rxCode}.`);
    process.exit(1);
  }

  // Use the head of the chain (highest version). If only voided rows
  // exist we surface that as a warning but proceed.
  const head = chain[0] as {
    id: string;
    prescription_code: string;
    version: number;
    status: string;
    doctor_id: string;
    session_id: string;
    booking_id: string;
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
    bp_sys: number | null;
    bp_dia: number | null;
    pulse_bpm: number | null;
    spo2_pct: number | null;
    temp_c: number | null;
    height_cm: number | null;
    past_medical_history: string | null;
    presenting_complaints_duration: string | null;
  };

  if (head.status === "draft") {
    console.error(
      `Head of chain ${rxCode} is a draft (v${head.version}). Drafts have no PDF to reissue — send it from the doctor surface first.`,
    );
    process.exit(1);
  }
  if (head.status === "voided") {
    console.warn(
      `[reissue_rx] WARNING: head of chain ${rxCode} v${head.version} is VOIDED. Re-rendering anyway — patient access remains revoked.`,
    );
  }
  if (!head.pdf_storage_path) {
    console.error(
      `${rxCode} v${head.version} has no pdf_storage_path; cannot determine target object key.`,
    );
    process.exit(1);
  }

  console.log(
    `[reissue_rx] Target: ${head.prescription_code} v${head.version} (${head.status}) → ${head.pdf_storage_path}`,
  );

  // ---- Doctor lookup ----
  // v5 dropped stamp rendering — only signature_image_url is needed.
  // doctors.stamp_image_url column kept in DB for future v6 (Task #17).
  const { data: doctorRow, error: doctorErr } = await supabase
    .from("doctors")
    .select(
      "id, full_name, qualification, registration_no, issuing_council, signature_image_url",
    )
    .eq("id", head.doctor_id)
    .maybeSingle();
  if (doctorErr || !doctorRow) {
    console.error(`Could not load doctor ${head.doctor_id}: ${doctorErr?.message ?? "not found"}`);
    process.exit(1);
  }
  const doctor = doctorRow as {
    id: string;
    full_name: string;
    qualification: string | null;
    registration_no: string | null;
    issuing_council: string | null;
    signature_image_url: string | null;
  };
  if (!doctor.signature_image_url) {
    console.error(
      `Doctor ${doctor.full_name} has no signature_image_url; cannot render. Upload the signature from /ops/doctors first.`,
    );
    process.exit(1);
  }

  // ---- Items (with composition via medicine_catalog FK) ----
  const { data: itemsData, error: itemsErr } = await supabase
    .from("prescription_items")
    .select(
      "ordinal, drug_name, dose, frequency, duration, instructions, medicine:medicine_catalog(composition)",
    )
    .eq("prescription_id", head.id)
    .order("ordinal", { ascending: true });
  if (itemsErr) {
    console.error(`Could not load items: ${itemsErr.message}`);
    process.exit(1);
  }
  const items = (itemsData ?? []) as unknown as Array<{
    ordinal: number;
    drug_name: string;
    dose: string | null;
    frequency: string | null;
    duration: string | null;
    instructions: string | null;
    medicine: { composition: string | null } | null;
  }>;

  // ---- Lab tests ----
  const { data: labData, error: labErr } = await supabase
    .from("prescription_lab_tests")
    .select("ordinal, test_name, instructions")
    .eq("prescription_id", head.id)
    .order("ordinal", { ascending: true });
  if (labErr && labErr.code !== "PGRST116") {
    console.error(`Could not load lab tests: ${labErr.message}`);
    process.exit(1);
  }
  const labTests = (labData ?? []) as unknown as Array<{
    ordinal: number;
    test_name: string;
    instructions: string | null;
  }>;

  // ---- Booking → customer + v5 booking-snapshot fields ----
  const { data: bookingData, error: bookingErr } = await supabase
    .from("bookings")
    .select(
      "id, booking_code, patient_name, booked_through, sponsor_label, payment_status, amount, customer:customers(full_name, customer_code)",
    )
    .eq("id", head.booking_id)
    .maybeSingle();
  if (bookingErr || !bookingData) {
    console.error(`Could not load booking ${head.booking_id}: ${bookingErr?.message ?? "not found"}`);
    process.exit(1);
  }
  // PostgREST sometimes returns embedded references as arrays in
  // the generated row shape; the to-many vs to-one resolution flips
  // depending on FK direction inference. We cast through `unknown`
  // to a flat single-record shape (the booking.customer FK is
  // single-target).
  const booking = bookingData as unknown as {
    id: string;
    booking_code: string | null;
    patient_name: string | null;
    booked_through: string | null;
    sponsor_label: string | null;
    payment_status: string | null;
    amount: number | null;
    customer: { full_name: string | null; customer_code: string | null } | null;
  };

  // v5 dropped consult_mode from the rendered PDF — session lookup
  // removed entirely (no other field on consultation_sessions matters
  // for re-rendering).

  // v5 booking-snapshot fields for the patient-info table.
  const bookedThrough = booking.booked_through ?? "Website";
  const sponsorLabel = deriveSponsorLabel(
    booking.sponsor_label,
    booking.payment_status,
    booking.amount,
  );

  // ---- Build PrescriptionPdfData ----
  const pdfData: PrescriptionPdfData = {
    prescription_code: head.prescription_code,
    version: head.version,
    sent_at_iso: head.sent_at,
    doctor_full_name: doctor.full_name,
    doctor_qualification: doctor.qualification,
    doctor_registration_no: doctor.registration_no,
    doctor_issuing_council: doctor.issuing_council,
    patient_name: head.patient_name,
    patient_age: head.patient_age,
    patient_sex: head.patient_sex,
    patient_weight_kg: head.patient_weight_kg,
    patient_code: booking.customer?.customer_code ?? null,
    booking_code: booking.booking_code,
    booked_through: bookedThrough,
    sponsor_label: sponsorLabel,
    bp_sys: head.bp_sys,
    bp_dia: head.bp_dia,
    pulse_bpm: head.pulse_bpm,
    spo2_pct: head.spo2_pct,
    temp_c: head.temp_c,
    height_cm: head.height_cm,
    chief_complaint: head.chief_complaint,
    presenting_complaints_duration: head.presenting_complaints_duration,
    provisional_diagnosis: head.provisional_diagnosis,
    past_medical_history: head.past_medical_history,
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
    general_advice: head.general_advice,
    follow_up_advice: head.follow_up_advice,
  };

  console.log(`[reissue_rx] Rendering PDF for ${doctor.full_name}'s ${head.prescription_code} v${head.version}...`);

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderPrescriptionPdf({
      data: pdfData,
      signature: { kind: "storagePath", path: doctor.signature_image_url },
    });
  } catch (e) {
    console.error(`PDF render failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  console.log(`[reissue_rx] PDF rendered: ${pdfBuffer.byteLength.toLocaleString()} bytes.`);

  // ---- Upload (overwrite the existing object) ----
  console.log(`[reissue_rx] Uploading to prescriptions/${head.pdf_storage_path} (upsert: true)...`);
  const { error: uploadErr } = await supabase.storage
    .from("prescriptions")
    .upload(head.pdf_storage_path, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (uploadErr) {
    console.error(`Upload failed: ${uploadErr.message}`);
    process.exit(1);
  }

  console.log(`[reissue_rx] ✓ Reissued ${head.prescription_code} v${head.version}.`);
  if (head.patient_view_token) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://sanocare.in";
    console.log(`[reissue_rx]   Patient URL: ${siteUrl.replace(/\/+$/, "")}/rx/${head.patient_view_token}`);
    console.log(`[reissue_rx]   (cache-bust with ?v=${Date.now()} if CDN edge needs nudging)`);
  }

  // Silence unused-import lint when path import is only used by tsx
  // path resolution checks — keeps the script clean.
  void resolve;
}

main().catch((e) => {
  console.error("[reissue_rx] Fatal:", e);
  process.exit(1);
});
