import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { getCurrentDoctor } from "../../../../_lib/getCurrentDoctor";
import { getDraftForSession } from "../../../../_lib/prescriptionData";
import { supabaseAdmin } from "@/lib/supabase-server";
import { createDraftPrescription } from "../../../../_actions/prescription";
import { formatIST } from "@/lib/time/formatIST";
import { PrescriptionComposer } from "./PrescriptionComposer";

export const metadata: Metadata = {
  title: "Compose prescription · Sanocare",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type SessionContext = {
  id: string;
  booking_id: string;
  doctor_id: string;
  status: string;
  scheduled_at: string;
  patient_name: string;
  booking_code: string | null;
};

async function loadSessionContext(
  session_id: string,
  doctor_id: string,
): Promise<SessionContext | null> {
  // Step 1 — session row, scoped to the doctor.
  const { data: session, error } = await supabaseAdmin
    .from("consultation_sessions")
    .select("id, booking_id, doctor_id, status, scheduled_at")
    .eq("id", session_id)
    .maybeSingle();
  if (error || !session) return null;
  if ((session as { doctor_id: string }).doctor_id !== doctor_id) {
    // Session not owned by this doctor — don't disclose that it exists.
    return null;
  }
  // Step 2 — booking row for patient name + code (denormalised display).
  const { data: booking } = await supabaseAdmin
    .from("bookings")
    .select("id, booking_code, patient_name, customer:customers(full_name)")
    .eq("id", (session as { booking_id: string }).booking_id)
    .maybeSingle();
  if (!booking) return null;
  const cust = (booking as unknown as { customer: { full_name: string | null } | null }).customer;
  const patientName =
    cust?.full_name ??
    (booking as { patient_name: string | null }).patient_name ??
    "Patient";
  return {
    id: (session as { id: string }).id,
    booking_id: (session as { booking_id: string }).booking_id,
    doctor_id: (session as { doctor_id: string }).doctor_id,
    status: (session as { status: string }).status,
    scheduled_at: (session as { scheduled_at: string }).scheduled_at,
    patient_name: patientName,
    booking_code: (booking as { booking_code: string | null }).booking_code,
  };
}

export default async function PrescribePage({
  params,
}: {
  params: Promise<{ session_id: string }>;
}) {
  const { session_id } = await params;
  const doctor = await getCurrentDoctor();
  const ctx = await loadSessionContext(session_id, doctor.id);
  if (!ctx) notFound();

  const draft = await getDraftForSession(session_id);

  // Sanity check the doctor has the basics ops should have set up
  // before they're issuing scripts. We let them open the composer
  // either way (so they can see what's missing), but the Send button
  // refuses on the server side too.
  const setupGaps: string[] = [];
  if (!doctor.registration_no || doctor.registration_no.trim() === "") {
    setupGaps.push(
      "Your registration number isn't on file — ask ops to add it.",
    );
  }
  // signature presence is checked at send time (not loaded here to
  // keep getCurrentDoctor() lean). We surface a soft note instead.

  return (
    <div className="max-w-5xl mx-auto px-6 sm:px-8 py-8">
      {/* breadcrumb */}
      <Link
        href="/doctor"
        className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Duty Room
      </Link>

      <div className="mb-6">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1">
          Prescription · {ctx.booking_code ?? "—"}
        </div>
        <h1 className="text-2xl font-bold text-slate-900">
          {ctx.patient_name}
        </h1>
        <div className="text-sm text-slate-600 mt-1">
          Consult scheduled {formatIST(ctx.scheduled_at)}
        </div>
      </div>

      {setupGaps.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-semibold mb-1">Profile incomplete</div>
          <ul className="list-disc pl-5 space-y-1">
            {setupGaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      )}

      {draft ? (
        <PrescriptionComposer
          rxId={draft.id}
          sessionId={ctx.id}
          initial={{
            prescription_code: draft.prescription_code,
            version: draft.version,
            patient_name: draft.patient_name,
            patient_age: draft.patient_age,
            patient_sex: draft.patient_sex,
            patient_weight_kg: draft.patient_weight_kg,
            // M026 vitals (passed through; null when not yet set)
            bp_sys: draft.bp_sys,
            bp_dia: draft.bp_dia,
            pulse_bpm: draft.pulse_bpm,
            spo2_pct: draft.spo2_pct,
            temp_c: draft.temp_c,
            height_cm: draft.height_cm,
            chief_complaint: draft.chief_complaint,
            presenting_complaints_duration: draft.presenting_complaints_duration,
            provisional_diagnosis: draft.provisional_diagnosis,
            past_medical_history: draft.past_medical_history,
            general_advice: draft.general_advice,
            follow_up_advice: draft.follow_up_advice,
            items: draft.items.map((it) => ({
              ordinal: it.ordinal,
              drug_name: it.drug_name,
              dose: it.dose,
              frequency: it.frequency,
              duration: it.duration,
              instructions: it.instructions,
              medicine_sku: it.medicine_sku,
              composition: it.composition,
            })),
            lab_tests: draft.lab_tests.map((t) => ({
              ordinal: t.ordinal,
              test_name: t.test_name,
              instructions: t.instructions,
              lab_test_id: t.lab_test_id,
              catalog_code: t.catalog_code,
              catalog_category: t.catalog_category,
              catalog_price_paise: t.catalog_price_paise,
            })),
          }}
        />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <FileText className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-slate-900 mb-1">
            No draft yet for this consultation
          </h2>
          <p className="text-sm text-slate-600 mb-5">
            Starting a draft allocates the next Rx number (SAN-RX-…) and
            opens the composer.
          </p>
          <form action={createDraftPrescription}>
            <input type="hidden" name="session_id" value={ctx.id} />
            <button
              type="submit"
              className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-5 py-2.5 rounded-lg"
            >
              <FileText className="w-4 h-4" /> Start prescription draft
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

