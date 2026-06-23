import Link from "next/link";
import type { Metadata } from "next";
import { requireOpsAdmin } from "../../_lib/requireOpsAdmin";
import { supabaseAdmin } from "@/lib/supabase-server";
import { formatIST } from "@/lib/time/formatIST";
import { rupees } from "@/lib/doctorFinance";
import { GdaOpsPanel } from "./GdaOpsPanel";

export const metadata: Metadata = {
  title: "Ops · GDA / Attendants",
  robots: { index: false, follow: false },
};

// GDA Phase 1 (M064) — ops surface (internal, ops-driven). Admin only.
//
// Lists active deployments with shift completion + posted payout, and exposes
// the create/schedule panel (GDA, deployment, shift). The GDA tables are
// RLS deny-all, so this server component reads via the service-role client
// AFTER the requireOpsAdmin() gate — never the anon RSC client (which would be
// blocked). Patient-facing booking is Phase 2; this is the internal console.

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type DeploymentRow = {
  id: string;
  patient_name: string;
  shift_pattern: string;
  start_date: string;
  end_date: string | null;
  status: string;
  customer_id: string | null;
  medication_consent_at: string | null;
  created_at: string;
};

export default async function GdaOpsPage() {
  await requireOpsAdmin();

  const [{ data: deployments }, { data: gdas }] = await Promise.all([
    supabaseAdmin
      .from("gda_deployments")
      .select(
        "id, patient_name, shift_pattern, start_date, end_date, status, customer_id, medication_consent_at, created_at",
      )
      .order("status", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(200),
    supabaseAdmin
      .from("medics")
      .select("id, full_name, phone, insulin_med_cleared, active")
      .eq("staff_type", "gda")
      .order("full_name", { ascending: true }),
  ]);

  const deploymentRows = (deployments ?? []) as DeploymentRow[];
  const gdaRows = (gdas ?? []) as Array<{
    id: string;
    full_name: string;
    phone: string;
    insulin_med_cleared: boolean;
    active: boolean;
  }>;

  // Shift rollup per deployment (count + done + posted payout).
  const ids = deploymentRows.map((d) => d.id);
  const rollup = new Map<
    string,
    { total: number; done: number; payoutPaise: number }
  >();
  if (ids.length > 0) {
    const { data: shifts } = await supabaseAdmin
      .from("gda_shifts")
      .select("id, deployment_id, status")
      .in("deployment_id", ids);
    const shiftRows = (shifts ?? []) as Array<{
      id: string;
      deployment_id: string;
      status: string;
    }>;

    const shiftIds = shiftRows.map((s) => s.id);
    const netByShift = new Map<string, number>();
    if (shiftIds.length > 0) {
      const { data: ledger } = await supabaseAdmin
        .from("medic_ledger_entries")
        .select("gda_shift_id, amount_paise")
        .in("gda_shift_id", shiftIds);
      for (const r of (ledger ?? []) as Array<{
        gda_shift_id: string | null;
        amount_paise: number;
      }>) {
        if (!r.gda_shift_id) continue;
        netByShift.set(
          r.gda_shift_id,
          (netByShift.get(r.gda_shift_id) ?? 0) + r.amount_paise,
        );
      }
    }

    for (const s of shiftRows) {
      const cur = rollup.get(s.deployment_id) ?? {
        total: 0,
        done: 0,
        payoutPaise: 0,
      };
      cur.total += 1;
      if (s.status === "done") cur.done += 1;
      cur.payoutPaise += netByShift.get(s.id) ?? 0;
      rollup.set(s.deployment_id, cur);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="mb-8">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1">
          GDA Phase 1 · Internal
        </div>
        <h1 className="text-2xl font-semibold text-slate-900">
          GDA / Attendants
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Attendant deployments under{" "}
          <span className="font-mono">homecare</span>. Create a GDA, open a
          deployment, schedule 12h / 24h shifts. Patient-facing booking is
          Phase 2.
        </p>
      </div>

      <GdaOpsPanel gdas={gdaRows} />

      <h2 className="mt-10 mb-3 text-sm font-semibold text-slate-700">
        Deployments ({deploymentRows.length})
      </h2>
      <div className="overflow-hidden rounded-2xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-mono uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Patient</th>
              <th className="px-4 py-2.5">Pattern</th>
              <th className="px-4 py-2.5">Dates</th>
              <th className="px-4 py-2.5">Shifts</th>
              <th className="px-4 py-2.5">Posted payout</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {deploymentRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No deployments yet.
                </td>
              </tr>
            ) : (
              deploymentRows.map((d) => {
                const r = rollup.get(d.id);
                return (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/ops/gda/${d.id}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {d.patient_name}
                      </Link>
                      {d.medication_consent_at && (
                        <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                          med-consent
                        </span>
                      )}
                      {!d.customer_id && (
                        <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                          no customer link
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {d.shift_pattern}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {formatIST(d.start_date, "date")}
                      {" → "}
                      {d.end_date ? formatIST(d.end_date, "date") : "open"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {r ? `${r.done}/${r.total} done` : "0"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {rupees(r?.payoutPaise ?? 0)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          "rounded px-1.5 py-0.5 text-[10px] font-medium " +
                          (d.status === "active"
                            ? "bg-blue-50 text-blue-700"
                            : d.status === "paused"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-slate-100 text-slate-500")
                        }
                      >
                        {d.status}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
