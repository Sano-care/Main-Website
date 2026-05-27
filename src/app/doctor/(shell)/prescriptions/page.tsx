import type { Metadata } from "next";
import { getDoctorPrescriptionsList } from "../../_lib/prescriptionData";
import { PrescriptionsTabbed, type RxListRow } from "./PrescriptionsTabbed";

export const metadata: Metadata = {
  title: "My prescriptions · Sanocare",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function DoctorPrescriptionsList() {
  const all = await getDoctorPrescriptionsList();

  // Hand the full set to the client tab switcher. Two visible tabs
  // (Drafts | Sent) per the v3 brief; the Sent tab also surfaces
  // superseded + voided rows with their own status pill so the
  // doctor has a single "issued" pane for everything beyond draft.
  const rows = all.map<RxListRow>((r) => ({
    id: r.id,
    prescription_code: r.prescription_code,
    version: r.version,
    status: r.status,
    patient_name: r.patient_name,
    session_id: r.session_id,
    created_at: r.created_at,
    sent_at: r.sent_at,
    whatsapp_sent_at: r.whatsapp_sent_at,
  }));

  return (
    <div className="max-w-5xl mx-auto px-6 sm:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">My prescriptions</h1>
        <p className="text-sm text-slate-600 mt-1">
          Everything you&apos;ve drafted or sent. Latest version of each
          chain shown — open one to see prior versions.
        </p>
      </div>

      <PrescriptionsTabbed rows={rows} />
    </div>
  );
}
