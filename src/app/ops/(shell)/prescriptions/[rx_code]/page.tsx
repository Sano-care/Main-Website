import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  FileX,
  History,
} from "lucide-react";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { getCurrentOpsUser } from "../../../_lib/getCurrentOpsUser";
import { RxOpsActions } from "./RxOpsActions";

export const metadata: Metadata = {
  title: "Ops · Prescription detail",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type RxRow = {
  id: string;
  prescription_code: string;
  version: number;
  status: "draft" | "sent" | "superseded" | "voided";
  doctor_id: string;
  session_id: string;
  booking_id: string;
  superseded_by: string | null;
  patient_name: string;
  patient_age: number | null;
  patient_sex: "M" | "F" | "O" | "U" | null;
  patient_weight_kg: number | null;
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
  doctor: { doctor_code: string; full_name: string; registration_no: string | null } | null;
  booking: { booking_code: string | null } | null;
};

type ItemRow = {
  id: string;
  ordinal: number;
  drug_name: string;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
};

export default async function OpsRxDetail({
  params,
  searchParams,
}: {
  params: Promise<{ rx_code: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { rx_code } = await params;
  const sp = await searchParams;
  const version = sp.v ? Number(sp.v) : undefined;

  await getCurrentOpsUser();
  const supabase = await createOpsRSCClient();

  let query = supabase
    .from("prescriptions")
    .select(
      "id, prescription_code, version, status, doctor_id, session_id, booking_id, superseded_by, patient_name, patient_age, patient_sex, patient_weight_kg, chief_complaint, provisional_diagnosis, general_advice, follow_up_advice, pdf_storage_path, patient_view_token, whatsapp_sent_at, whatsapp_message_id, created_at, sent_at, voided_at, void_reason, doctor:doctors(doctor_code, full_name, registration_no), booking:bookings(booking_code)",
    )
    .eq("prescription_code", rx_code);
  if (version != null) query = query.eq("version", version);
  else query = query.order("version", { ascending: false });
  const { data, error } = await query.limit(1).maybeSingle();

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-6 sm:px-8 py-8">
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-4 text-sm">
          {error.message}
        </div>
      </div>
    );
  }
  if (!data) notFound();
  const rx = data as unknown as RxRow;

  // Chain navigator
  const { data: chainData } = await supabase
    .from("prescriptions")
    .select("version, status")
    .eq("prescription_code", rx_code)
    .order("version", { ascending: true });
  const chain = (chainData as { version: number; status: string }[] | null) ?? [];

  // Items
  const { data: itemsData } = await supabase
    .from("prescription_items")
    .select("id, ordinal, drug_name, dose, frequency, duration, instructions")
    .eq("prescription_id", rx.id)
    .order("ordinal", { ascending: true });
  const items = (itemsData as ItemRow[] | null) ?? [];

  const rxUrl =
    rx.status === "sent" && rx.patient_view_token
      ? `${(process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://sanocare.in").replace(/\/+$/, "")}/rx/${rx.patient_view_token}`
      : null;

  return (
    <div className="max-w-4xl mx-auto px-6 sm:px-8 py-8">
      <Link
        href="/ops/prescriptions"
        className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Prescriptions
      </Link>

      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1">
            Prescription
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900 font-mono">
              {rx.prescription_code}
            </h1>
            <StatusPill status={rx.status} />
            {rx.version > 1 && (
              <span className="text-xs text-slate-500">version {rx.version}</span>
            )}
          </div>
          <div className="text-sm text-slate-600 mt-1">
            {rx.patient_name}
            {rx.booking?.booking_code && (
              <>
                {" "}·{" "}
                <Link
                  href={`/ops/bookings/${rx.booking_id}`}
                  className="hover:underline text-slate-700"
                >
                  {rx.booking.booking_code}
                </Link>
              </>
            )}
            {rx.doctor && (
              <>
                {" "}·{" "}
                <Link
                  href={`/ops/doctors/${rx.doctor_id}`}
                  className="hover:underline text-slate-700"
                >
                  {rx.doctor.full_name}
                </Link>
              </>
            )}
          </div>
        </div>

        <RxOpsActions
          prescriptionId={rx.id}
          status={rx.status}
          whatsappSentAt={rx.whatsapp_sent_at}
          rxUrl={rxUrl}
          hasPdf={rx.pdf_storage_path != null}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <DetailCard label="Patient snapshot">
          <div className="text-base font-semibold">{rx.patient_name}</div>
          <div className="text-xs text-slate-500 mt-1">
            {[
              rx.patient_age != null ? `Age ${rx.patient_age}` : null,
              rx.patient_sex ? sexLabel(rx.patient_sex) : null,
              rx.patient_weight_kg != null ? `${rx.patient_weight_kg} kg` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "—"}
          </div>
        </DetailCard>

        <DetailCard label="Delivery">
          {rx.status === "sent" ? (
            rx.whatsapp_sent_at ? (
              <div className="flex items-center gap-1.5 text-emerald-700 text-sm">
                <CheckCircle2 className="w-4 h-4" /> WhatsApp delivered
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-amber-700 text-sm">
                <AlertCircle className="w-4 h-4" /> Pending — use Resend
              </div>
            )
          ) : rx.status === "voided" ? (
            <div className="flex items-center gap-1.5 text-rose-700 text-sm">
              <FileX className="w-4 h-4" /> Voided
              {rx.void_reason ? ` — ${rx.void_reason}` : ""}
            </div>
          ) : rx.status === "superseded" ? (
            <div className="flex items-center gap-1.5 text-slate-600 text-sm">
              <History className="w-4 h-4" /> Superseded
            </div>
          ) : (
            <div className="text-sm text-slate-400">Draft</div>
          )}
          {rx.whatsapp_message_id && (
            <div className="text-[10px] text-slate-400 mt-1 font-mono">
              msg: {rx.whatsapp_message_id}
            </div>
          )}
        </DetailCard>
      </div>

      <Block label="Chief complaint" value={rx.chief_complaint} />
      <Block label="Provisional diagnosis" value={rx.provisional_diagnosis} />

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden mb-4">
        <div className="px-6 py-3 border-b border-slate-100 text-[11px] font-mono uppercase tracking-wider text-slate-500">
          Medications ({items.length})
        </div>
        {items.length === 0 ? (
          <div className="px-6 py-4 text-sm text-slate-400 italic">
            (no medications)
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs">
              <tr>
                <th className="px-4 py-2 text-left w-8">#</th>
                <th className="px-4 py-2 text-left">Drug</th>
                <th className="px-4 py-2 text-left">Dose</th>
                <th className="px-4 py-2 text-left">Frequency</th>
                <th className="px-4 py-2 text-left">Duration</th>
                <th className="px-4 py-2 text-left">Instructions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-500 font-mono">{it.ordinal}</td>
                  <td className="px-4 py-2 font-medium">{it.drug_name}</td>
                  <td className="px-4 py-2">{it.dose ?? "—"}</td>
                  <td className="px-4 py-2">{it.frequency ?? "—"}</td>
                  <td className="px-4 py-2">{it.duration ?? "—"}</td>
                  <td className="px-4 py-2">{it.instructions ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Block label="General advice" value={rx.general_advice} />
      <Block label="Follow-up" value={rx.follow_up_advice} />

      {chain.length > 1 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 mt-4">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-2">
            Version history
          </div>
          <ul className="flex gap-2 flex-wrap">
            {chain.map((c) => (
              <li key={c.version}>
                <Link
                  href={`/ops/prescriptions/${rx_code}?v=${c.version}`}
                  className={
                    "inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-md " +
                    (c.version === rx.version
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200")
                  }
                >
                  v{c.version}
                  <span className="text-[9px] uppercase tracking-wider opacity-70">
                    {c.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DetailCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-2">
        {label}
      </div>
      {children}
    </div>
  );
}

function Block({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-4">
      <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1">
        {label}
      </div>
      <div className="text-sm text-slate-800 whitespace-pre-wrap">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "sent"
      ? "bg-emerald-100 text-emerald-800"
      : status === "draft"
        ? "bg-amber-100 text-amber-800"
        : status === "voided"
          ? "bg-rose-100 text-rose-800"
          : "bg-slate-100 text-slate-700";
  return (
    <span
      className={
        "inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full " +
        cls
      }
    >
      {status}
    </span>
  );
}

function sexLabel(s: "M" | "F" | "O" | "U"): string {
  return { M: "Male", F: "Female", O: "Other", U: "Unspecified" }[s];
}
