#!/usr/bin/env tsx
/**
 * scripts/dry_render_rx.ts
 *
 * Dry-run renderer for an existing prescription. Loads the row +
 * doctor + items (with composition via the medicine_catalog FK) +
 * lab tests + booking customer/booking codes + session modality via
 * the SAME loaders the production sendPrescription path uses, then
 * renders a PDF with the current template.
 *
 * Two modes
 * ---------
 *   DRY_RUN=1 (sandbox)
 *     - Writes the rendered buffer to /tmp/dry-rx-<code>-<ts>.pdf
 *     - Uploads to the prescriptions bucket under
 *       _dry-runs/<code>-<ts>.pdf (kept out of the live tree)
 *     - Mints a 24-hour signed URL via createSignedUrl() and logs it
 *     - Skips the production overwrite + WhatsApp delivery entirely
 *
 *   default (issue)
 *     - Overwrites the row's existing pdf_storage_path (upsert: true)
 *     - Patient_view_token, sent_at, WhatsApp delivery state are
 *       preserved — only the bytes flip.
 *     - Triggers a fresh WhatsApp deliver via sendRxLink so the
 *       patient is nudged back to the new PDF.
 *
 * Usage
 * -----
 *   DRY_RUN=1 npx tsx scripts/dry_render_rx.ts SAN-RX-00001
 *   npx tsx scripts/dry_render_rx.ts SAN-RX-00001
 *
 * If no Rx code is passed, defaults to SAN-RX-00001 (the founder's
 * pilot prescription — the row v3 was built to upgrade visually).
 *
 * Required env vars (no .env auto-load):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Plus when running OUTSIDE dry-run mode (real WhatsApp send):
 *   WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN,
 *   WHATSAPP_RX_ENABLED, WHATSAPP_RX_TEMPLATE_DOCUMENT_HEADER_OK
 *   NEXT_PUBLIC_SITE_URL
 *
 * Sanity-checks the service-role key payload to refuse running with
 * the anon key (the v7 import-script footgun).
 */

import { writeFile } from "node:fs/promises";
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

const DRY_RUN = process.env.DRY_RUN === "1";
const rxCode = process.argv[2]?.trim() || "SAN-RX-00001";

// ---------------------------------------------------------------------
// Imports from the runtime app surface. tsx transpiles these at run
// time; the explicit `../src/...` paths bypass the @/* alias which tsx
// doesn't resolve.

import {
  renderPrescriptionPdf,
} from "../src/lib/rx/pdf/renderPrescriptionPdf";
import type {
  PrescriptionPdfData,
} from "../src/lib/rx/pdf/PrescriptionPdf";
import {
  sendRxLink,
  isRxDocumentHeaderEnabled,
  MetaRxDeliveryError,
} from "../src/lib/rx/meta";

// ---------------------------------------------------------------------
// Helpers

const PRESCRIPTIONS_BUCKET = "prescriptions";

/**
 * Mirror of deriveSponsorLabel() in src/app/doctor/_actions/prescription.ts.
 * Kept local here so the script has no app-action dependency at runtime.
 *
 *   explicit (bookings.sponsor_label) wins if non-empty.
 *   CAPTURED + amount > 0  → "Self Pay ₹<amt>"
 *   amount == 0            → "Test"
 *   anything else          → "Self Pay"
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

function tsSafe(): string {
  // 2026-05-27T13-42-19Z — no colons (S3 / Linux fs-safe).
  return new Date().toISOString().replace(/[:.]/g, "-");
}

// ---------------------------------------------------------------------
// Main

async function main() {
  console.log(
    `[dry_render_rx] mode=${DRY_RUN ? "DRY_RUN" : "ISSUE"} target=${rxCode}`,
  );

  // ---- Walk to chain head ----
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
      `Head of chain ${rxCode} is a draft (v${head.version}). Drafts have no PDF to render — send it from the doctor surface first.`,
    );
    process.exit(1);
  }
  if (head.status === "voided") {
    console.warn(
      `[dry_render_rx] WARNING: head of chain ${rxCode} v${head.version} is VOIDED.`,
    );
  }
  if (!DRY_RUN && !head.pdf_storage_path) {
    console.error(
      `${rxCode} v${head.version} has no pdf_storage_path; cannot determine target object key for ISSUE mode.`,
    );
    process.exit(1);
  }

  console.log(
    `[dry_render_rx] head: ${head.prescription_code} v${head.version} (${head.status}) → ${head.pdf_storage_path ?? "<no pdf path>"}`,
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
    console.error(
      `Could not load doctor ${head.doctor_id}: ${doctorErr?.message ?? "not found"}`,
    );
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
      `Doctor ${doctor.full_name} has no signature_image_url; cannot render.`,
    );
    process.exit(1);
  }

  // ---- Items (composition via medicine_catalog FK) ----
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

  // ---- Booking → customer + booking code + patient phone ----
  const { data: bookingData, error: bookingErr } = await supabase
    .from("bookings")
    .select(
      "id, booking_code, patient_name, phone, booked_through, sponsor_label, payment_status, amount, customer:customers(full_name, phone, customer_code)",
    )
    .eq("id", head.booking_id)
    .maybeSingle();
  if (bookingErr || !bookingData) {
    console.error(
      `Could not load booking ${head.booking_id}: ${bookingErr?.message ?? "not found"}`,
    );
    process.exit(1);
  }
  const booking = bookingData as unknown as {
    id: string;
    booking_code: string | null;
    patient_name: string | null;
    phone: string | null;
    booked_through: string | null;
    sponsor_label: string | null;
    payment_status: string | null;
    amount: number | null;
    customer: {
      full_name: string | null;
      phone: string | null;
      customer_code: string | null;
    } | null;
  };

  // ---- Session modality + scheduled_at (for the body-only template's
  //      {{3}} consultation_date placeholder) ----
  const { data: sessionData, error: sessionErr } = await supabase
    .from("consultation_sessions")
    .select("modality, scheduled_at")
    .eq("id", head.session_id)
    .maybeSingle();
  if (sessionErr) {
    console.error(
      `Could not load session ${head.session_id}: ${sessionErr.message}`,
    );
    process.exit(1);
  }
  const sessionRowTyped = sessionData as {
    modality?: string | null;
    scheduled_at?: string | null;
  } | null;
  // v5 dropped consult_mode from the rendered PDF — kept session lookup
  // only for the WhatsApp template's {{3}} consultation_date placeholder.
  const consultationDateIso =
    sessionRowTyped?.scheduled_at ?? head.sent_at ?? new Date().toISOString();

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

  // ---- Render ----
  console.log(`[dry_render_rx] rendering ${head.prescription_code} v${head.version}...`);
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
  console.log(
    `[dry_render_rx] rendered ${pdfBuffer.byteLength.toLocaleString()} bytes.`,
  );

  // =====================================================================
  // Sandbox branch (DRY_RUN=1)
  // =====================================================================
  if (DRY_RUN) {
    const ts = tsSafe();
    const localPath = resolve(`/tmp/dry-rx-${head.prescription_code}-${ts}.pdf`);
    const storagePath = `_dry-runs/${head.prescription_code}-${ts}.pdf`;

    // Write local copy first — useful if storage upload fails.
    try {
      await writeFile(localPath, pdfBuffer);
      console.log(`[dry_render_rx] wrote local copy: ${localPath}`);
    } catch (e) {
      console.warn(
        `[dry_render_rx] could not write /tmp copy (${e instanceof Error ? e.message : String(e)}); continuing.`,
      );
    }

    // Upload to the prescriptions bucket under _dry-runs/ — keeping
    // sandbox renders alongside the real ones but namespaced so they
    // never collide with patient-facing keys.
    console.log(
      `[dry_render_rx] uploading to ${PRESCRIPTIONS_BUCKET}/${storagePath}...`,
    );
    const { error: uploadErr } = await supabase.storage
      .from(PRESCRIPTIONS_BUCKET)
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadErr) {
      console.error(`Upload failed: ${uploadErr.message}`);
      process.exit(1);
    }

    // 24-hour signed URL — long enough for an out-of-band review with
    // an annotation pass but short enough that a forwarded link
    // expires before a casual reshare matters.
    const { data: signed, error: signErr } = await supabase.storage
      .from(PRESCRIPTIONS_BUCKET)
      .createSignedUrl(storagePath, 24 * 60 * 60);
    if (signErr || !signed?.signedUrl) {
      console.error(
        `Could not sign URL: ${signErr?.message ?? "no signedUrl returned"}`,
      );
      process.exit(1);
    }

    console.log("");
    console.log(`✓ DRY_RUN complete for ${head.prescription_code} v${head.version}`);
    console.log("");
    console.log("  Signed URL (valid 24 h):");
    console.log(`  ${signed.signedUrl}`);
    console.log("");
    console.log(`  Local copy: ${localPath}`);
    console.log(`  Sandbox key: ${PRESCRIPTIONS_BUCKET}/${storagePath}`);
    return;
  }

  // =====================================================================
  // Issue branch (DRY_RUN unset) — overwrite + WhatsApp send
  // =====================================================================
  if (!head.pdf_storage_path) {
    console.error("Cannot issue: head.pdf_storage_path is null.");
    process.exit(1);
  }

  console.log(
    `[dry_render_rx] ISSUE: overwriting ${PRESCRIPTIONS_BUCKET}/${head.pdf_storage_path} (upsert: true)...`,
  );
  const { error: uploadErr } = await supabase.storage
    .from(PRESCRIPTIONS_BUCKET)
    .upload(head.pdf_storage_path, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (uploadErr) {
    console.error(`Upload failed: ${uploadErr.message}`);
    process.exit(1);
  }
  console.log("[dry_render_rx] overwrite OK; pdf_storage_path content refreshed.");

  // WhatsApp re-deliver — uses the existing patient_view_token so the
  // patient hits the same /rx/<token> URL (now serving the fresh PDF).
  const patientPhone = booking.customer?.phone ?? booking.phone ?? null;
  if (!patientPhone) {
    console.warn(
      `[dry_render_rx] no patient phone on booking ${booking.id}; skipping WhatsApp resend. Share /rx/${head.patient_view_token} manually if needed.`,
    );
    return;
  }
  if (!head.patient_view_token) {
    console.warn(
      `[dry_render_rx] no patient_view_token on head (status=${head.status}); skipping WhatsApp resend.`,
    );
    return;
  }

  const patientName = booking.customer?.full_name ?? booking.patient_name ?? head.patient_name;

  // Document-header template needs a 1-hour signed URL Meta can fetch
  // when rendering the message. Same handling as sendPrescription.
  let signedPdfUrl: string | null = null;
  if (isRxDocumentHeaderEnabled()) {
    const { data: signed, error: signErr } = await supabase.storage
      .from(PRESCRIPTIONS_BUCKET)
      .createSignedUrl(head.pdf_storage_path, 60 * 60);
    if (signErr || !signed?.signedUrl) {
      console.error(
        `Could not sign PDF for Meta: ${signErr?.message ?? "no signedUrl"}`,
      );
    } else {
      signedPdfUrl = signed.signedUrl;
    }
  }

  try {
    console.log(`[dry_render_rx] WhatsApp resend to ${patientPhone}...`);
    const send = await sendRxLink({
      phone: patientPhone,
      patientName,
      doctorName: doctor.full_name,
      patientViewToken: head.patient_view_token,
      signedPdfUrl,
      prescriptionCode: head.prescription_code,
      consultationDateIso, // body-only template {{3}} — see rx/meta.ts
    });
    console.log(
      `[dry_render_rx] WhatsApp OK (messageId=${send.providerMessageId ?? "<none>"}).`,
    );
  } catch (e) {
    if (e instanceof MetaRxDeliveryError) {
      console.warn(
        `[dry_render_rx] WhatsApp delivery failed: ${e.message}. Patient can still hit /rx/${head.patient_view_token}.`,
      );
    } else {
      console.error("[dry_render_rx] unexpected delivery error:", e);
    }
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://sanocare.in";
  console.log("");
  console.log(`✓ ISSUE complete for ${head.prescription_code} v${head.version}`);
  console.log(
    `  Patient URL: ${siteUrl.replace(/\/+$/, "")}/rx/${head.patient_view_token}`,
  );
}

main().catch((e) => {
  console.error("[dry_render_rx] Fatal:", e);
  process.exit(1);
});
