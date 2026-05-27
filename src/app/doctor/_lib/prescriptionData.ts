import { cache } from "react";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getCurrentDoctor } from "./getCurrentDoctor";

// =====================================================================
// Doctor-scoped accessors for the e-prescription module.
//
// Same A1 posture as doctorData.ts: every accessor pulls
// getCurrentDoctor() and filters by that doctor's id. The caller never
// supplies a doctor_id parameter.
//
// Surface:
//   getDraftForSession(session_id)        → composer entry point
//   getDoctorPrescriptionsList()          → /doctor/prescriptions
//   getDoctorPrescriptionByCode(code)     → detail page (latest version
//                                           in the chain by default)
// =====================================================================

/** 60 minutes from sent_at. Doctor sees an "Amend" button while this
 *  window is open; after it closes the only remedy is "Void + new". */
export const AMEND_WINDOW_MINUTES = 60;

export type DoctorRxListItem = {
  id: string;
  prescription_code: string;
  version: number;
  status: "draft" | "sent" | "superseded" | "voided";
  session_id: string;
  booking_id: string;
  patient_name: string;
  sent_at: string | null;
  created_at: string;
  whatsapp_sent_at: string | null;
};

export type DoctorRxItem = {
  id: string;
  ordinal: number;
  drug_name: string;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
  /** Optional FK into medicine_catalog (M026). Set when the doctor
   *  picked the drug from autocomplete. */
  medicine_sku: number | null;
  /** Composition pulled via the medicine_catalog join. Null for
   *  free-text rows. */
  composition: string | null;
};

export type DoctorRxLabTest = {
  id: string;
  ordinal: number;
  test_name: string;
  instructions: string | null;
  /** Optional FK into lab_tests (M027). Set when the doctor picked the
   *  test from autocomplete. */
  lab_test_id: string | null;
  /** Catalog fields hydrated via LEFT JOIN on lab_tests. All null when
   *  lab_test_id is null (free-text row). Surfaced in the composer's
   *  test row so doctor sees "Lipid Profile · Routine · ₹450" not just
   *  "Lipid". The rendered PDF stays test_name + instructions only —
   *  these are doctor-UX-only fields. */
  catalog_code: string | null;
  catalog_category: string | null;
  catalog_method: string | null;
  catalog_sample: string | null;
  catalog_tat: string | null;
  catalog_price_paise: number | null;
};

export type DoctorRxDetail = {
  id: string;
  prescription_code: string;
  version: number;
  status: "draft" | "sent" | "superseded" | "voided";
  session_id: string;
  booking_id: string;
  superseded_by: string | null;
  patient_name: string;
  patient_age: number | null;
  patient_sex: "M" | "F" | "O" | "U" | null;
  patient_weight_kg: number | null;
  // M026 vitals (all optional)
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
  pdf_storage_path: string | null;
  patient_view_token: string | null;
  whatsapp_sent_at: string | null;
  whatsapp_message_id: string | null;
  created_at: string;
  sent_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  items: DoctorRxItem[];
  lab_tests: DoctorRxLabTest[];
};

/**
 * Look up the latest non-voided draft prescription for a session, if
 * any. Used by the composer page to decide whether to render the
 * editor (if a draft exists) or show the "Create draft" CTA.
 */
export const getDraftForSession = cache(
  async (session_id: string): Promise<DoctorRxDetail | null> => {
    const doctor = await getCurrentDoctor();
    const { data, error } = await supabaseAdmin
      .from("prescriptions")
      .select(
        "id, prescription_code, version, status, session_id, booking_id, superseded_by, patient_name, patient_age, patient_sex, patient_weight_kg, bp_sys, bp_dia, pulse_bpm, spo2_pct, temp_c, height_cm, chief_complaint, provisional_diagnosis, general_advice, follow_up_advice, pdf_storage_path, patient_view_token, whatsapp_sent_at, whatsapp_message_id, created_at, sent_at, voided_at, void_reason",
      )
      .eq("session_id", session_id)
      .eq("doctor_id", doctor.id)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[getDraftForSession] supabase error:", error);
      throw new Error(`Could not load draft Rx: ${error.message}`);
    }
    if (!data) return null;

    const items = await loadItems(data.id);
    const lab_tests = await loadLabTests(data.id);
    return {
      ...(data as Omit<DoctorRxDetail, "items" | "lab_tests">),
      items,
      lab_tests,
    };
  },
);

/**
 * List of Rx visible to the doctor on /doctor/prescriptions.
 * Newest first by created_at. Includes drafts, sent, superseded, voided
 * — the UI groups them. Limit 100 keeps the page bounded.
 */
export const getDoctorPrescriptionsList = cache(
  async (): Promise<DoctorRxListItem[]> => {
    const doctor = await getCurrentDoctor();
    const { data, error } = await supabaseAdmin
      .from("prescriptions")
      .select(
        "id, prescription_code, version, status, session_id, booking_id, patient_name, sent_at, created_at, whatsapp_sent_at",
      )
      .eq("doctor_id", doctor.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      console.error("[getDoctorPrescriptionsList] supabase error:", error);
      throw new Error(`Could not load prescriptions list: ${error.message}`);
    }
    return (data as DoctorRxListItem[] | null) ?? [];
  },
);

/**
 * Resolve a prescription_code + optional version to a full detail row,
 * scoped to the current doctor. When version is omitted, returns the
 * HEAD of the chain (the row whose superseded_by is NULL, OR the
 * latest if all rows are interconnected — falls back to MAX(version)
 * for safety).
 */
export const getDoctorPrescriptionByCode = cache(
  async (
    prescription_code: string,
    version?: number,
  ): Promise<DoctorRxDetail> => {
    const doctor = await getCurrentDoctor();
    let query = supabaseAdmin
      .from("prescriptions")
      .select(
        "id, prescription_code, version, status, session_id, booking_id, superseded_by, patient_name, patient_age, patient_sex, patient_weight_kg, bp_sys, bp_dia, pulse_bpm, spo2_pct, temp_c, height_cm, chief_complaint, provisional_diagnosis, general_advice, follow_up_advice, pdf_storage_path, patient_view_token, whatsapp_sent_at, whatsapp_message_id, created_at, sent_at, voided_at, void_reason",
      )
      .eq("doctor_id", doctor.id)
      .eq("prescription_code", prescription_code);
    if (version != null) {
      query = query.eq("version", version);
    } else {
      query = query.order("version", { ascending: false });
    }
    const { data, error } = await query.limit(1).maybeSingle();
    if (error) {
      console.error("[getDoctorPrescriptionByCode] supabase error:", error);
      throw new Error(`Could not load prescription: ${error.message}`);
    }
    if (!data) notFound();
    const items = await loadItems(data.id);
    const lab_tests = await loadLabTests(data.id);
    return {
      ...(data as Omit<DoctorRxDetail, "items" | "lab_tests">),
      items,
      lab_tests,
    };
  },
);

/**
 * Returns true while the amend window is still open for a sent Rx.
 * After 60 minutes the doctor must "Void + start new" instead.
 */
export function isAmendWindowOpen(sent_at: string | null): boolean {
  if (!sent_at) return false;
  const sentMs = new Date(sent_at).getTime();
  if (!Number.isFinite(sentMs)) return false;
  return Date.now() - sentMs < AMEND_WINDOW_MINUTES * 60 * 1000;
}

async function loadItems(rxId: string): Promise<DoctorRxItem[]> {
  const { data, error } = await supabaseAdmin
    .from("prescription_items")
    .select(
      "id, ordinal, drug_name, dose, frequency, duration, instructions, medicine_sku, medicine:medicine_catalog(composition)",
    )
    .eq("prescription_id", rxId)
    .order("ordinal", { ascending: true });
  if (error) {
    console.error("[loadItems] supabase error:", error);
    throw new Error(`Could not load Rx items: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    ordinal: number;
    drug_name: string;
    dose: string | null;
    frequency: string | null;
    duration: string | null;
    instructions: string | null;
    medicine_sku: number | null;
    medicine: { composition: string | null } | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    ordinal: r.ordinal,
    drug_name: r.drug_name,
    dose: r.dose,
    frequency: r.frequency,
    duration: r.duration,
    instructions: r.instructions,
    medicine_sku: r.medicine_sku,
    composition: r.medicine?.composition ?? null,
  }));
}

async function loadLabTests(rxId: string): Promise<DoctorRxLabTest[]> {
  // LEFT JOIN against lab_tests (M027) so catalog fields hydrate when
  // the row carries a lab_test_id, and stay null for free-text rows.
  // Supabase-js translates the `catalog:lab_tests(...)` embed into a
  // PostgREST inner-or-outer join based on the FK definition; M027's
  // FK was created with ON DELETE SET NULL, so PostgREST treats this
  // as an outer join (null catalog block when lab_test_id is null).
  const { data, error } = await supabaseAdmin
    .from("prescription_lab_tests")
    .select(
      "id, ordinal, test_name, instructions, lab_test_id, catalog:lab_tests(code, category, method, sample, tat, price_paise)",
    )
    .eq("prescription_id", rxId)
    .order("ordinal", { ascending: true });
  if (error) {
    // PGRST116 = empty result; older Rx may also predate M026. Treat
    // either case as "no lab tests" rather than throwing.
    if (error.code === "PGRST116") return [];
    console.error("[loadLabTests] supabase error:", error);
    throw new Error(`Could not load Rx lab tests: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as Array<{
    id: string;
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
    id: r.id,
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
