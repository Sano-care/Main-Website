import type { Metadata } from "next";
import { getCurrentDoctor } from "../_lib/getCurrentDoctor";
import { getDoctorLedger } from "../_lib/doctorData";
import { computeDoctorFigures, rupees } from "@/app/ops/_lib/doctorFinance";
import { DoctorFiguresGrid } from "../_components/DoctorFiguresGrid";
import { DoctorLedgerTable } from "../_components/DoctorLedgerTable";
import { EnterDutyRoomButton } from "../_components/EnterDutyRoomButton";

export const metadata: Metadata = {
  title: "Doctor home · Sanocare",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/**
 * Doctor home — the only protected page in C1.
 *
 * Everything is read-only for the doctor. The data path:
 *   getCurrentDoctor()   — profile row scoped to the verified session
 *   getDoctorLedger()    — ledger entries scoped to the verified session
 *                          (returns both oldestFirst for figures and
 *                          newestFirst for display, with running balance
 *                          pre-computed)
 *
 * Neither accessor takes a doctor_id from the URL / query / body — the
 * id always comes from the verified cookie via getCurrentDoctorSession().
 * This is the A1 enforcement boundary: there is no doctor-supplied
 * doctor_id parameter anywhere in the doctor surface.
 */
export default async function DoctorHomePage() {
  const [doctor, ledger] = await Promise.all([getCurrentDoctor(), getDoctorLedger()]);

  const figures = computeDoctorFigures(ledger.oldestFirst);

  const payTermsSummary =
    doctor.doctor_type === "freelancer"
      ? `${doctor.revenue_share_pct ?? 0}% of (booking fee + balance) per completed booking`
      : `${rupees(doctor.daily_wage_paise ?? 0)} / day present · ${rupees(
          doctor.commission_per_visit_paise ?? 0,
        )} / completed visit` +
        (doctor.overtime_hourly_paise
          ? ` · ${rupees(doctor.overtime_hourly_paise)} / overtime hr`
          : "");

  return (
    <div className="max-w-5xl mx-auto px-6 sm:px-8 py-8">
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
        </div>
        <div className="text-sm text-slate-600 mt-2">{payTermsSummary}</div>
        {doctor.qualification && (
          <div className="text-xs text-slate-500 mt-1">{doctor.qualification}</div>
        )}
      </div>

      {/* ============================== Enter Duty Room ============================== */}
      <EnterDutyRoomButton url={doctor.duty_room_join_url} />

      {/* ============================== Figures ============================== */}
      <DoctorFiguresGrid
        totalEarnedPaise={figures.totalEarnedPaise}
        totalPaidOutPaise={figures.totalPaidOutPaise}
        balancePaise={figures.balancePaise}
      />

      {/* ============================== Ledger ============================== */}
      <DoctorLedgerTable entries={ledger.newestFirst} />

      <p className="text-[11px] text-slate-400 text-center mt-8">
        Read-only view. Any changes to pay terms, attendance, or ledger entries
        are made by ops. Contact ops if anything looks wrong.
      </p>
    </div>
  );
}
