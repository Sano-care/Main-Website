import Link from "next/link";
import type { Metadata } from "next";
import { Search, Plus, HeartPulse } from "lucide-react";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { getCurrentOpsUser } from "../../_lib/getCurrentOpsUser";
import { formatIST } from "@/lib/time/formatIST";
import { rupees } from "@/lib/doctorFinance";

export const metadata: Metadata = {
  title: "Ops · Medics",
  robots: { index: false, follow: false },
};

// T65 Phase 2B C3-full — Medics Hub list page.
// Mirrors /ops/doctors list pattern (force-dynamic cache directives,
// server-rendered table, searchParams filters, server actions for writes).
//
// Surfaces last clock-in (medic_attendance) + current-month payout
// outstanding (SUM(medic_ledger_entries.amount_paise) for current
// calendar month, IST). agent role can read everything; admin sees
// "Add Medic" button + can navigate to detail edit/deactivate.

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type MedicRow = {
  id: string;
  full_name: string;
  phone: string;
  qualification: "GNM" | "B.Sc Nursing";
  license_number: string | null;
  active: boolean;
  hire_date: string | null;
  created_at: string;
};

type AttendanceSlice = {
  medic_id: string;
  clock_in_at: string;
};

type LedgerSlice = {
  medic_id: string;
  amount_paise: number;
};

function sanitizeSearch(q: string): string {
  return q.replace(/[%,()]/g, "").trim().slice(0, 100);
}

function firstOfMonthIST(): string {
  // First day of current month, midnight IST, as ISO UTC.
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  // Midnight IST = previous-day-18:30 UTC
  return new Date(Date.UTC(y, m, 1, -5, -30)).toISOString();
}

export default async function MedicsListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; active?: string }>;
}) {
  const sp = await searchParams;
  const q = sanitizeSearch(sp.q ?? "");
  const active = sp.active ?? "";

  const opsUser = await getCurrentOpsUser();
  const isAdmin = opsUser.role === "admin";

  const supabase = await createOpsRSCClient();

  let query = supabase
    .from("medics")
    .select(
      "id, full_name, phone, qualification, license_number, active, hire_date, created_at",
    );
  if (active === "yes") query = query.eq("active", true);
  if (active === "no") query = query.eq("active", false);
  if (q) {
    query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[ops/medics] list lookup failed", error);
  }

  const medics = (data as MedicRow[] | null) ?? [];

  // Batched last-clock-in lookup. We grab the latest clock_in_at per
  // medic_id by ordering desc + JS-side reduce — RPC would be cleaner
  // but the medic_attendance table is small enough that a single SELECT
  // is cheaper than a function call.
  const lastClockInByMedicId = new Map<string, string>();
  const monthPayoutByMedicId = new Map<string, number>();
  if (medics.length > 0) {
    const ids = medics.map((m) => m.id);
    const [attendanceRes, ledgerRes] = await Promise.all([
      supabase
        .from("medic_attendance")
        .select("medic_id, clock_in_at")
        .in("medic_id", ids)
        .order("clock_in_at", { ascending: false }),
      supabase
        .from("medic_ledger_entries")
        .select("medic_id, amount_paise")
        .in("medic_id", ids)
        .gte("entry_date", firstOfMonthIST().slice(0, 10)),
    ]);
    for (const a of (attendanceRes.data as AttendanceSlice[] | null) ?? []) {
      // First row per medic_id wins (desc ordered).
      if (!lastClockInByMedicId.has(a.medic_id)) {
        lastClockInByMedicId.set(a.medic_id, a.clock_in_at);
      }
    }
    for (const e of (ledgerRes.data as LedgerSlice[] | null) ?? []) {
      monthPayoutByMedicId.set(
        e.medic_id,
        (monthPayoutByMedicId.get(e.medic_id) ?? 0) + e.amount_paise,
      );
    }
  }

  return (
    <div className="px-8 py-8">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1">
            Operations
          </div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <HeartPulse className="w-6 h-6 text-slate-700" />
            Medics
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            {medics.length} record{medics.length === 1 ? "" : "s"}
            {(q || active) && " · filtered"}
          </p>
        </div>
        {isAdmin && (
          <Link
            href="/ops/medics/new"
            className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Medic
          </Link>
        )}
      </div>

      <form className="bg-white border border-slate-200 rounded-2xl p-4 mb-6" method="GET">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
                placeholder="Name or phone"
                className="w-full bg-white border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              />
            </div>
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
            className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            Apply
          </button>
          {(q || active) && (
            <Link
              href="/ops/medics"
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              Clear
            </Link>
          )}
        </div>
      </form>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left text-[10px] font-mono uppercase tracking-wider text-slate-500 px-4 py-3">Name</th>
              <th className="text-left text-[10px] font-mono uppercase tracking-wider text-slate-500 px-4 py-3">Phone</th>
              <th className="text-left text-[10px] font-mono uppercase tracking-wider text-slate-500 px-4 py-3">Qualification</th>
              <th className="text-left text-[10px] font-mono uppercase tracking-wider text-slate-500 px-4 py-3">License</th>
              <th className="text-left text-[10px] font-mono uppercase tracking-wider text-slate-500 px-4 py-3">Last clock-in</th>
              <th className="text-right text-[10px] font-mono uppercase tracking-wider text-slate-500 px-4 py-3">Outstanding (month)</th>
              <th className="text-left text-[10px] font-mono uppercase tracking-wider text-slate-500 px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {medics.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                  No medics found.
                  {isAdmin && (
                    <>
                      {" "}
                      <Link href="/ops/medics/new" className="text-slate-900 hover:underline">
                        Add the first one
                      </Link>
                      .
                    </>
                  )}
                </td>
              </tr>
            )}
            {medics.map((m) => {
              const lastIn = lastClockInByMedicId.get(m.id);
              const outstanding = monthPayoutByMedicId.get(m.id) ?? 0;
              return (
                <tr key={m.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/ops/medics/${m.id}`} className="text-sm font-medium text-slate-900 hover:underline">
                      {m.full_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-slate-600">{m.phone}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{m.qualification}</td>
                  <td className="px-4 py-3 text-sm font-mono text-slate-500">{m.license_number ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {lastIn ? formatIST(lastIn, "relativeShort") : "Never"}
                  </td>
                  <td className="px-4 py-3 text-sm text-right tabular-nums font-mono text-slate-700">
                    {outstanding === 0 ? "—" : rupees(outstanding)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        m.active
                          ? "bg-green-50 text-green-700 border border-green-200"
                          : "bg-slate-100 text-slate-600 border border-slate-200"
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${
                          m.active ? "bg-green-500" : "bg-slate-400"
                        }`}
                      />
                      {m.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
