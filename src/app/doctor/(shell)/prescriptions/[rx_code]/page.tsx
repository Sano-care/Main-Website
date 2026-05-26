import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ExternalLink, MessageSquare, CheckCircle2, AlertCircle, FileX, History } from "lucide-react";
import {
  getDoctorPrescriptionByCode,
  isAmendWindowOpen,
  AMEND_WINDOW_MINUTES,
  type DoctorRxDetail,
} from "../../../_lib/prescriptionData";
import { getCurrentDoctor } from "../../../_lib/getCurrentDoctor";
import { supabaseAdmin } from "@/lib/supabase-server";
import { AmendButton, VoidButton } from "./RxDetailActions";

export const metadata: Metadata = {
  title: "Prescription detail · Sanocare",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function DoctorRxDetail({
  params,
  searchParams,
}: {
  params: Promise<{ rx_code: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { rx_code } = await params;
  const sp = await searchParams;
  const version = sp.v ? Number(sp.v) : undefined;

  const doctor = await getCurrentDoctor();
  // Loads the requested version (or the latest) of this code, scoped
  // to the current doctor. notFound() on miss.
  const rx = await getDoctorPrescriptionByCode(rx_code, version);

  // Load the chain so the doctor can navigate versions. Scoped by
  // doctor_id (A1) — same lookup that prescriptionData.ts uses.
  const { data: chainRows } = await supabaseAdmin
    .from("prescriptions")
    .select("id, prescription_code, version, status, sent_at, voided_at, superseded_by")
    .eq("prescription_code", rx_code)
    .eq("doctor_id", doctor.id)
    .order("version", { ascending: true });
  const chain = chainRows ?? [];

  // For the patient-view URL we resolve from the live row's token (if
  // status='sent'); voided rows have token cleared, superseded rows
  // we don't surface a link for (they're history).
  const rxUrl = rxPublicUrl(rx);

  return (
    <div className="max-w-4xl mx-auto px-6 sm:px-8 py-8">
      <Link
        href="/doctor/prescriptions"
        className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> My prescriptions
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
            <span
              className={
                "inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full " +
                statusPillClass(rx.status)
              }
            >
              {rx.status}
            </span>
            {rx.version > 1 && (
              <span className="text-xs text-slate-500">version {rx.version}</span>
            )}
          </div>
          <div className="text-sm text-slate-600 mt-1">
            {rx.patient_name}
          </div>
        </div>

        {/* Action column */}
        <div className="flex flex-col items-end gap-2">
          {rx.status === "sent" && rxUrl && (
            <a
              href={rxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-slate-700 hover:text-slate-900 px-3 py-1.5 rounded-md border border-slate-300"
            >
              <ExternalLink className="w-3 h-3" /> Patient view
            </a>
          )}
          {rx.status === "sent" && (
            <div className="flex gap-2">
              {isAmendWindowOpen(rx.sent_at) ? (
                <AmendButton prescriptionId={rx.id} />
              ) : (
                <span
                  className="text-[10px] text-slate-400 italic"
                  title={`Amend window closes ${AMEND_WINDOW_MINUTES} min after sending.`}
                >
                  Amend window closed
                </span>
              )}
              <VoidButton prescriptionId={rx.id} />
            </div>
          )}
        </div>
      </div>

      {/* Patient + clinical body */}
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <DetailCard label="Patient">
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
                <AlertCircle className="w-4 h-4" /> Delivery failed — ops may
                deliver manually
              </div>
            )
          ) : rx.status === "draft" ? (
            <div className="text-sm text-slate-400">Not yet sent</div>
          ) : rx.status === "voided" ? (
            <div className="flex items-center gap-1.5 text-rose-700 text-sm">
              <FileX className="w-4 h-4" /> Voided
              {rx.void_reason ? ` — ${rx.void_reason}` : ""}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-slate-600 text-sm">
              <History className="w-4 h-4" /> Superseded by later version
            </div>
          )}
          {rx.sent_at && (
            <div className="text-[11px] text-slate-500 mt-1">
              Sent {formatWhen(rx.sent_at)}
            </div>
          )}
        </DetailCard>
      </div>

      <Block label="Chief complaint" value={rx.chief_complaint} />
      <Block label="Provisional diagnosis" value={rx.provisional_diagnosis} />

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden mb-4">
        <div className="px-6 py-3 border-b border-slate-100 text-[11px] font-mono uppercase tracking-wider text-slate-500">
          Medications
        </div>
        {rx.items.length === 0 ? (
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
              {rx.items.map((it) => (
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

      {/* Chain navigator (only when more than one version exists) */}
      {chain.length > 1 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 mt-6">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-2">
            Version history
          </div>
          <ul className="flex gap-2 flex-wrap">
            {chain.map((c) => {
              const row = c as { version: number; status: string };
              const active = row.version === rx.version;
              return (
                <li key={row.version}>
                  <Link
                    href={`/doctor/prescriptions/${rx_code}?v=${row.version}`}
                    className={
                      "inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-md " +
                      (active
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200")
                    }
                  >
                    v{row.version}
                    <span className="text-[9px] uppercase tracking-wider opacity-70">
                      {row.status}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {rxUrl && rx.status === "sent" && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
          <div className="font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" /> Patient-view URL
          </div>
          <code className="font-mono text-[11px] break-all">{rxUrl}</code>
        </div>
      )}
    </div>
  );
}

function rxPublicUrl(rx: DoctorRxDetail): string | null {
  if (rx.status !== "sent" || !rx.patient_view_token) return null;
  const base = (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://sanocare.in"
  ).replace(/\/+$/, "");
  return `${base}/rx/${rx.patient_view_token}`;
}

function DetailCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
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

function statusPillClass(status: string): string {
  switch (status) {
    case "draft":
      return "bg-amber-100 text-amber-800";
    case "sent":
      return "bg-emerald-100 text-emerald-800";
    case "superseded":
      return "bg-slate-100 text-slate-600";
    case "voided":
      return "bg-rose-100 text-rose-800";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function sexLabel(s: "M" | "F" | "O" | "U"): string {
  return { M: "Male", F: "Female", O: "Other", U: "Unspecified" }[s];
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
