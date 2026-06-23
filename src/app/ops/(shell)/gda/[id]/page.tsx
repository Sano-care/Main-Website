import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOpsAdmin } from "../../../_lib/requireOpsAdmin";
import { supabaseAdmin } from "@/lib/supabase-server";
import { formatIST } from "@/lib/time/formatIST";
import { rupees } from "@/lib/doctorFinance";
import { UUID_RE } from "@/lib/gda/shared";

export const metadata: Metadata = {
  title: "Ops · GDA Deployment",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// GDA Phase 1 (M064) — deployment detail. Shifts + per-GDA posted payout
// (net of gda_shift ledger rows, so a reversed shift reads ₹0). Admin only.

export default async function GdaDeploymentDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOpsAdmin();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const { data: deployment } = await supabaseAdmin
    .from("gda_deployments")
    .select(
      "id, patient_name, address, customer_id, booking_id, shift_pattern, start_date, end_date, rate_per_shift_paise, medication_consent_at, status, created_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!deployment) notFound();

  const { data: shifts } = await supabaseAdmin
    .from("gda_shifts")
    .select(
      "id, gda_id, shift_date, shift_kind, status, clock_in_at, clock_out_at, payout_paise",
    )
    .eq("deployment_id", id)
    .order("shift_date", { ascending: true });
  const shiftRows = (shifts ?? []) as Array<{
    id: string;
    gda_id: string;
    shift_date: string;
    shift_kind: string;
    status: string;
    clock_in_at: string | null;
    clock_out_at: string | null;
    payout_paise: number | null;
  }>;

  const shiftIds = shiftRows.map((s) => s.id);
  const netByShift = new Map<string, number>();
  const gdaNames = new Map<string, string>();
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
    const gdaIds = Array.from(new Set(shiftRows.map((s) => s.gda_id)));
    const { data: gdas } = await supabaseAdmin
      .from("medics")
      .select("id, full_name")
      .in("id", gdaIds);
    for (const g of (gdas ?? []) as Array<{ id: string; full_name: string }>) {
      gdaNames.set(g.id, g.full_name);
    }
  }

  const payoutByGda = new Map<string, number>();
  for (const s of shiftRows) {
    payoutByGda.set(
      s.gda_id,
      (payoutByGda.get(s.gda_id) ?? 0) + (netByShift.get(s.id) ?? 0),
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <Link href="/ops/gda" className="text-xs text-blue-600 hover:underline">
        ← All deployments
      </Link>
      <h1 className="mt-3 text-2xl font-semibold text-slate-900">
        {deployment.patient_name}
      </h1>
      <p className="mt-1 text-sm text-slate-500">{deployment.address}</p>

      <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-slate-500">Pattern</dt>
          <dd className="font-mono">{deployment.shift_pattern}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Dates</dt>
          <dd>
            {formatIST(deployment.start_date, "date")} →{" "}
            {deployment.end_date
              ? formatIST(deployment.end_date, "date")
              : "open"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Status</dt>
          <dd>{deployment.status}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Customer rate / shift</dt>
          <dd className="font-mono">
            {deployment.rate_per_shift_paise != null
              ? rupees(deployment.rate_per_shift_paise)
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Medication consent</dt>
          <dd>
            {deployment.medication_consent_at
              ? formatIST(deployment.medication_consent_at, "datetime")
              : "not captured"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Customer link</dt>
          <dd>{deployment.customer_id ? "linked" : "none (checklist-only vitals)"}</dd>
        </div>
      </dl>

      <h2 className="mt-8 mb-2 text-sm font-semibold text-slate-700">
        Shifts ({shiftRows.length})
      </h2>
      <div className="overflow-hidden rounded-2xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-mono uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Date</th>
              <th className="px-4 py-2.5">Kind</th>
              <th className="px-4 py-2.5">GDA</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">In / Out</th>
              <th className="px-4 py-2.5">Posted payout</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shiftRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No shifts scheduled.
                </td>
              </tr>
            ) : (
              shiftRows.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 text-xs">
                    {formatIST(s.shift_date, "date")}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{s.shift_kind}</td>
                  <td className="px-4 py-3 text-xs">
                    {gdaNames.get(s.gda_id) ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs">{s.status}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {s.clock_in_at ? formatIST(s.clock_in_at, "time") : "—"}
                    {" / "}
                    {s.clock_out_at ? formatIST(s.clock_out_at, "time") : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {rupees(netByShift.get(s.id) ?? 0)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 mb-2 text-sm font-semibold text-slate-700">
        Posted payout by GDA
      </h2>
      <div className="rounded-2xl border border-slate-200 p-4 text-sm">
        {payoutByGda.size === 0 ? (
          <span className="text-slate-400">Nothing posted yet.</span>
        ) : (
          <ul className="space-y-1">
            {Array.from(payoutByGda.entries()).map(([gdaId, paise]) => (
              <li key={gdaId} className="flex justify-between">
                <span>{gdaNames.get(gdaId) ?? gdaId}</span>
                <span className="font-mono">{rupees(paise)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
