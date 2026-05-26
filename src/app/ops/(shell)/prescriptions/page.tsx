import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, AlertCircle, FileX, History, FileText, Send } from "lucide-react";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { getCurrentOpsUser } from "../../_lib/getCurrentOpsUser";

export const metadata: Metadata = {
  title: "Ops · Prescriptions",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type Row = {
  id: string;
  prescription_code: string;
  version: number;
  status: "draft" | "sent" | "superseded" | "voided";
  doctor_id: string;
  booking_id: string;
  patient_name: string;
  sent_at: string | null;
  created_at: string;
  whatsapp_sent_at: string | null;
  doctor: { doctor_code: string; full_name: string } | null;
};

export default async function OpsPrescriptionsList({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await getCurrentOpsUser();
  const sp = await searchParams;
  const status = sp.status?.trim() ?? "";

  const supabase = await createOpsRSCClient();
  let query = supabase
    .from("prescriptions")
    .select(
      "id, prescription_code, version, status, doctor_id, booking_id, patient_name, sent_at, created_at, whatsapp_sent_at, doctor:doctors!doctor_id(doctor_code, full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (status && ["draft", "sent", "superseded", "voided"].includes(status)) {
    query = query.eq("status", status);
  }
  const { data, error } = await query;
  const rows = (data as unknown as Row[] | null) ?? [];

  return (
    <div className="max-w-6xl mx-auto px-6 sm:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Prescriptions</h1>
        <p className="text-sm text-slate-600 mt-1">
          All Rx written across all doctors. Filter by status, click into
          one to resend WhatsApp / download the PDF.
        </p>
      </div>

      <FilterBar current={status} />

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error.message}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left">Rx code</th>
              <th className="px-4 py-2 text-left">Patient</th>
              <th className="px-4 py-2 text-left">Doctor</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Delivery</th>
              <th className="px-4 py-2 text-left">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No prescriptions match.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-slate-900">
                    <Link
                      href={`/ops/prescriptions/${r.prescription_code}${r.version > 1 ? `?v=${r.version}` : ""}`}
                      className="hover:underline"
                    >
                      {r.prescription_code}
                      {r.version > 1 && (
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 ml-1">
                          v{r.version}
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{r.patient_name}</td>
                  <td className="px-4 py-2">
                    {r.doctor ? (
                      <Link
                        href={`/ops/doctors/${r.doctor_id}`}
                        className="text-slate-700 hover:text-slate-900 hover:underline"
                      >
                        <span className="font-mono text-xs text-slate-500 mr-1">
                          {r.doctor.doctor_code}
                        </span>
                        {r.doctor.full_name}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-4 py-2">
                    {r.status === "sent" ? (
                      r.whatsapp_sent_at ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 text-xs">
                          <CheckCircle2 className="w-3.5 h-3.5" /> WhatsApp
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-700 text-xs">
                          <AlertCircle className="w-3.5 h-3.5" /> Pending
                        </span>
                      )
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {formatWhen(r.sent_at ?? r.created_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterBar({ current }: { current: string }) {
  const options = [
    { v: "", label: "All", icon: <FileText className="w-3.5 h-3.5" /> },
    { v: "draft", label: "Drafts", icon: <FileText className="w-3.5 h-3.5" /> },
    { v: "sent", label: "Sent", icon: <Send className="w-3.5 h-3.5" /> },
    { v: "superseded", label: "Amended", icon: <History className="w-3.5 h-3.5" /> },
    { v: "voided", label: "Voided", icon: <FileX className="w-3.5 h-3.5" /> },
  ];
  return (
    <div className="flex gap-2 flex-wrap mb-4">
      {options.map((o) => {
        const active = current === o.v;
        const href = o.v === "" ? "/ops/prescriptions" : `/ops/prescriptions?status=${o.v}`;
        return (
          <Link
            key={o.v}
            href={href}
            className={
              "inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md " +
              (active
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200")
            }
          >
            {o.icon}
            {o.label}
          </Link>
        );
      })}
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

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
