import Link from "next/link";
import type { Metadata } from "next";
import { Search, Plus } from "lucide-react";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { getCurrentOpsUser } from "../../_lib/getCurrentOpsUser";
import { computeDoctorFigures, rupees } from "@/lib/doctorFinance";

export const metadata: Metadata = {
  title: "Ops · Doctors",
  robots: { index: false, follow: false },
};

// Same cache treatment as the other /ops list pages (M2.7 fix pattern).
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type DoctorRow = {
  id: string;
  doctor_code: string;
  full_name: string;
  doctor_type: "freelancer" | "salaried";
  is_active: boolean;
  revenue_share_pct: number | null;
  daily_wage_paise: number | null;
  commission_per_visit_paise: number | null;
  created_at: string;
};

type LedgerSlice = {
  doctor_id: string;
  amount_paise: number;
  entry_type: string;
};

function sanitizeSearch(q: string): string {
  return q.replace(/[%,()]/g, "").trim().slice(0, 100);
}

export default async function DoctorsListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; active?: string }>;
}) {
  const sp = await searchParams;
  const q = sanitizeSearch(sp.q ?? "");
  const type = sp.type ?? "";
  const active = sp.active ?? "";

  const opsUser = await getCurrentOpsUser();
  const isAdmin = opsUser.role === "admin";

  const supabase = await createOpsRSCClient();

  let query = supabase
    .from("doctors")
    .select(
      "id, doctor_code, full_name, doctor_type, is_active, revenue_share_pct, daily_wage_paise, commission_per_visit_paise, created_at",
    );

  if (type === "freelancer" || type === "salaried") {
    query = query.eq("doctor_type", type);
  }
  if (active === "yes") query = query.eq("is_active", true);
  if (active === "no") query = query.eq("is_active", false);
  if (q) {
    query = query.or(`full_name.ilike.%${q}%,doctor_code.ilike.%${q}%`);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(200);

  const doctors = (data as DoctorRow[] | null) ?? [];

  // Batched balance lookup — one query for all visible doctors, summed
  // per id in JS. The doctor_ledger_entries table is RLS-readable to any
  // ops user, so this works for admins and agents alike.
  const balanceByDoctorId = new Map<string, number>();
  if (doctors.length > 0) {
    const ids = doctors.map((d) => d.id);
    const { data: slices } = await supabase
      .from("doctor_ledger_entries")
      .select("doctor_id, amount_paise, entry_type")
      .in("doctor_id", ids);
    const entries = (slices as LedgerSlice[] | null) ?? [];
    for (const e of entries) {
      balanceByDoctorId.set(
        e.doctor_id,
        (balanceByDoctorId.get(e.doctor_id) ?? 0) + e.amount_paise,
      );
    }
  }

  // Best-effort dependency on computeDoctorFigures for typecheck (the
  // detail page is where it's actually used; here we only need balance).
  void computeDoctorFigures;

  return (
    <div className="px-8 py-8">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1">
            Operations
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Doctors</h1>
          <p className="text-sm text-slate-600 mt-1">
            {doctors.length} record{doctors.length === 1 ? "" : "s"}
            {(q || type || active) && " · filtered"}
          </p>
        </div>
        {isAdmin && (
          <Link
            href="/ops/doctors/new"
            className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New doctor
          </Link>
        )}
      </div>

      <form className="bg-white border border-slate-200 rounded-2xl p-4 mb-6" method="GET">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="lg:col-span-2">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              Search
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Name or SAN-D code"
                className="w-full bg-white border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              Type
            </label>
            <select
              name="type"
              defaultValue={type}
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            >
              <option value="">All</option>
              <option value="freelancer">Freelancer</option>
              <option value="salaried">Salaried</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              Active
            </label>
            <select
              name="active"
              defaultValue={active}
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            >
              <option value="">All</option>
              <option value="yes">Active only</option>
              <option value="no">Inactive only</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button
            type="submit"
            className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Apply
          </button>
          {(q || type || active) && (
            <Link href="/ops/doctors" className="text-sm text-slate-500 hover:text-slate-900">
              Clear filters
            </Link>
          )}
        </div>
      </form>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-3 mb-4">
          Could not load doctors: {error.message}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {doctors.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-500">
            {q || type || active
              ? "No doctors match the current filters."
              : isAdmin
                ? "No doctors yet. Click “New doctor” to add the first one."
                : "No doctors yet."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left">
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Code
                </th>
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Name
                </th>
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Type
                </th>
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Pay terms
                </th>
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Status
                </th>
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500 text-right">
                  Current balance
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {doctors.map((d) => {
                const balance = balanceByDoctorId.get(d.id) ?? 0;
                const payTerms =
                  d.doctor_type === "freelancer"
                    ? `${d.revenue_share_pct ?? 0}% revenue share`
                    : `${rupees(d.daily_wage_paise ?? 0)}/day + ${rupees(d.commission_per_visit_paise ?? 0)}/visit`;
                return (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link
                        href={`/ops/doctors/${d.id}`}
                        className="font-mono text-xs text-slate-900 hover:text-primary underline"
                      >
                        {d.doctor_code}
                      </Link>
                    </td>
                    <td className="px-5 py-3 font-medium text-slate-900">{d.full_name}</td>
                    <td className="px-5 py-3">
                      <span
                        className={
                          "inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full " +
                          (d.doctor_type === "freelancer"
                            ? "bg-violet-100 text-violet-800"
                            : "bg-blue-100 text-blue-800")
                        }
                      >
                        {d.doctor_type}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-600">{payTerms}</td>
                    <td className="px-5 py-3">
                      {d.is_active ? (
                        <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-700">
                          active
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                          inactive
                        </span>
                      )}
                    </td>
                    <td
                      className={
                        "px-5 py-3 text-right font-medium whitespace-nowrap " +
                        (balance > 0
                          ? "text-emerald-700"
                          : balance < 0
                            ? "text-rose-700"
                            : "text-slate-500")
                      }
                    >
                      {rupees(balance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
