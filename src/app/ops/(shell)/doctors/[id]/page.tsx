import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { getCurrentOpsUser } from "../../../_lib/getCurrentOpsUser";
import { computeDoctorFigures, rupees } from "@/lib/doctorFinance";
import { EditDoctorCard } from "./EditDoctorCard";
import { AttendanceSection } from "./AttendanceSection";
import { AdminActions } from "./AdminActions";

export const metadata: Metadata = {
  title: "Ops · Doctor detail",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type Doctor = {
  id: string;
  doctor_code: string;
  full_name: string;
  qualification: string | null;
  registration_no: string | null;
  phone: string | null;
  email: string | null;
  doctor_type: "freelancer" | "salaried";
  revenue_share_pct: number | null;
  daily_wage_paise: number | null;
  commission_per_visit_paise: number | null;
  overtime_hourly_paise: number | null;
  pay_notes: string | null;
  duty_room_join_url: string | null;
  is_active: boolean;
  created_at: string;
};

type LedgerEntry = {
  id: string;
  entry_type:
    | "revenue_share"
    | "commission"
    | "daily_wage"
    | "overtime"
    | "payout"
    | "adjustment"
    | "reversal";
  amount_paise: number;
  entry_date: string;
  description: string | null;
  booking_id: string | null;
  attendance_id: string | null;
  reverses_entry_id: string | null;
  created_at: string;
};

type AttendanceRow = {
  id: string;
  work_date: string;
  is_present: boolean;
  overtime_hours: number | null;
  overtime_amount_paise: number | null;
  note: string | null;
  created_at: string;
};

const ENTRY_TYPE_STYLE: Record<LedgerEntry["entry_type"], string> = {
  revenue_share: "bg-emerald-100 text-emerald-800",
  commission: "bg-emerald-100 text-emerald-800",
  daily_wage: "bg-blue-100 text-blue-800",
  overtime: "bg-violet-100 text-violet-800",
  payout: "bg-rose-100 text-rose-800",
  adjustment: "bg-amber-100 text-amber-800",
  reversal: "bg-slate-200 text-slate-700",
};

export default async function DoctorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createOpsRSCClient();
  const opsUser = await getCurrentOpsUser();
  const isAdmin = opsUser.role === "admin";

  const [doctorResult, ledgerResult, attendanceResult] = await Promise.all([
    supabase
      .from("doctors")
      .select(
        "id, doctor_code, full_name, qualification, registration_no, phone, email, doctor_type, revenue_share_pct, daily_wage_paise, commission_per_visit_paise, overtime_hourly_paise, pay_notes, duty_room_join_url, is_active, created_at",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("doctor_ledger_entries")
      .select(
        "id, entry_type, amount_paise, entry_date, description, booking_id, attendance_id, reverses_entry_id, created_at",
      )
      .eq("doctor_id", id)
      .order("entry_date", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(500),
    supabase
      .from("doctor_attendance")
      .select("id, work_date, is_present, overtime_hours, overtime_amount_paise, note, created_at")
      .eq("doctor_id", id)
      .order("work_date", { ascending: false })
      .limit(60),
  ]);

  const doctor = doctorResult.data as Doctor | null;
  if (!doctor) notFound();

  // Ledger comes back oldest-first so the running-balance walk is a
  // single forward pass. We reverse for display (newest first).
  const oldestFirst = (ledgerResult.data as LedgerEntry[] | null) ?? [];
  let runningBalance = 0;
  const ledgerOldestToNewest = oldestFirst.map((e) => {
    runningBalance += e.amount_paise;
    return { ...e, running_balance_paise: runningBalance };
  });
  const ledger = [...ledgerOldestToNewest].reverse();

  const figures = computeDoctorFigures(oldestFirst);

  const attendance = (attendanceResult.data as AttendanceRow[] | null) ?? [];

  const payTermsSummary =
    doctor.doctor_type === "freelancer"
      ? `${doctor.revenue_share_pct ?? 0}% of (booking fee + balance) per completed booking`
      : `${rupees(doctor.daily_wage_paise ?? 0)} / day present · ${rupees(doctor.commission_per_visit_paise ?? 0)} / completed visit` +
        (doctor.overtime_hourly_paise
          ? ` · ${rupees(doctor.overtime_hourly_paise)} / overtime hr`
          : "");

  return (
    <div className="px-8 py-8 max-w-5xl">
      <Link
        href="/ops/doctors"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to doctors
      </Link>

      {/* ============================== Header ============================== */}
      <div className="mb-6">
        <div className="font-mono text-xs text-slate-500 mb-1">{doctor.doctor_code}</div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-slate-900">{doctor.full_name}</h1>
          <span
            className={
              "inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full " +
              (doctor.doctor_type === "freelancer"
                ? "bg-violet-100 text-violet-800"
                : "bg-blue-100 text-blue-800")
            }
          >
            {doctor.doctor_type}
          </span>
          {!doctor.is_active && (
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
              inactive
            </span>
          )}
        </div>
        <div className="text-sm text-slate-600 mt-2">{payTermsSummary}</div>
      </div>

      {/* ============================== Figures ============================== */}
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <FigureCard
          label="Total earned"
          value={rupees(figures.totalEarnedPaise)}
          tone="emerald"
          sub="Gross of all earning entries"
        />
        <FigureCard
          label="Total paid out"
          value={rupees(figures.totalPaidOutPaise)}
          tone="rose"
          sub="Gross of all payout entries"
        />
        <FigureCard
          label="Current balance"
          value={rupees(figures.balancePaise)}
          tone={figures.balancePaise >= 0 ? "emerald" : "rose"}
          sub={figures.balancePaise >= 0 ? "Owed to doctor" : "Doctor owes Sanocare"}
          emphasis
        />
      </div>

      {/* ============================== Profile / Edit ============================== */}
      <EditDoctorCard doctor={doctor} isAdmin={isAdmin} />

      {/* ============================== Attendance (salaried only) ============================== */}
      {doctor.doctor_type === "salaried" && (
        <AttendanceSection
          doctorId={doctor.id}
          attendance={attendance}
          isAdmin={isAdmin}
        />
      )}

      {/* ============================== Admin actions ============================== */}
      {isAdmin && <AdminActions doctorId={doctor.id} />}

      {/* ============================== Ledger ============================== */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-baseline justify-between">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
            Ledger
          </div>
          <div className="text-xs text-slate-500">
            {ledger.length} entries · append-only · newest first
          </div>
        </div>
        {ledger.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-slate-500">
            No entries yet. Earnings post here automatically when a booking the
            doctor is assigned to reaches COMPLETED, when attendance is marked,
            or when an admin records a payout / adjustment.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left">
                  <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                    Date
                  </th>
                  <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                    Type
                  </th>
                  <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                    Description
                  </th>
                  <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500 text-right">
                    Amount
                  </th>
                  <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500 text-right">
                    Running balance
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ledger.map((e) => {
                  const isCredit = e.amount_paise >= 0;
                  return (
                    <tr key={e.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                        {new Date(e.entry_date).toLocaleDateString("en-IN")}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={
                            "inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full " +
                            ENTRY_TYPE_STYLE[e.entry_type]
                          }
                        >
                          {e.entry_type.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 max-w-md">
                        {e.description ?? "—"}
                        {e.booking_id && (
                          <Link
                            href={`/ops/bookings/${e.booking_id}`}
                            className="ml-2 text-xs text-slate-500 hover:text-slate-900 underline"
                          >
                            booking →
                          </Link>
                        )}
                      </td>
                      <td
                        className={
                          "px-4 py-3 text-right font-medium whitespace-nowrap " +
                          (isCredit ? "text-emerald-700" : "text-rose-700")
                        }
                      >
                        {rupees(e.amount_paise)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-800 whitespace-nowrap">
                        {rupees(e.running_balance_paise)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function FigureCard({
  label,
  value,
  sub,
  tone,
  emphasis,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "emerald" | "rose";
  emphasis?: boolean;
}) {
  return (
    <div
      className={
        "rounded-2xl border p-5 " +
        (emphasis
          ? "bg-slate-900 border-slate-900 text-white"
          : "bg-white border-slate-200")
      }
    >
      <div
        className={
          "text-[11px] font-mono uppercase tracking-wider " +
          (emphasis ? "text-slate-400" : "text-slate-500")
        }
      >
        {label}
      </div>
      <div
        className={
          "text-2xl font-bold mt-1 " +
          (emphasis
            ? "text-white"
            : tone === "emerald"
              ? "text-emerald-700"
              : "text-rose-700")
        }
      >
        {value}
      </div>
      <div className={"text-xs mt-1 " + (emphasis ? "text-slate-400" : "text-slate-500")}>
        {sub}
      </div>
    </div>
  );
}
