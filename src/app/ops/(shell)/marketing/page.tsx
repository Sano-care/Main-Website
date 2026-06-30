import type { Metadata } from "next";

import { requireOpsAdmin } from "@/app/ops/_lib/requireOpsAdmin";
import { fetchAttribution, type AttributionRow } from "@/lib/marketing/attribution";

export const metadata: Metadata = {
  title: "Ops · Marketing (CAC / ROAS)",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Default range = last 30 days (inclusive). */
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * DAY_MS);
  return { from: ymd(from), to: ymd(to) };
}

function rupees(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}
function fmtCac(p: number | null): string {
  return p == null ? "—" : rupees(p);
}
function fmtRoas(r: number | null): string {
  return r == null ? "—" : `${r.toFixed(2)}×`;
}
function fmtConv(c: number | null): string {
  return c == null ? "—" : `${(c * 100).toFixed(1)}%`;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function MarketingAttributionPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  // Explicit page-level gate (the (shell) layout also enforces ops auth — this
  // is belt-and-suspenders + the unit-testable seam). Non-admins are redirected.
  await requireOpsAdmin();

  const sp = await searchParams;
  const fallback = defaultRange();
  const range = {
    from: sp.from && YMD_RE.test(sp.from) ? sp.from : fallback.from,
    to: sp.to && YMD_RE.test(sp.to) ? sp.to : fallback.to,
  };

  const { rows, totals, spendPresent, latestSpendDate } = await fetchAttribution(range);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-xl font-semibold">Marketing — CAC / ROAS</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Bookings, not clicks. Closed-loop attribution per source / campaign.
      </p>

      <form method="get" className="mt-4 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col">
          <span className="text-neutral-500">From</span>
          <input type="date" name="from" defaultValue={range.from} className="rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col">
          <span className="text-neutral-500">To</span>
          <input type="date" name="to" defaultValue={range.to} className="rounded border px-2 py-1" />
        </label>
        <button type="submit" className="rounded border px-3 py-1 font-medium">
          Apply
        </button>
      </form>

      {!spendPresent && (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          ⚠️ No ad-spend recorded for this range. Spend is entered manually until the
          Meta / Google connectors are live — CAC / ROAS show “—” until spend is imported.
        </div>
      )}
      {spendPresent && latestSpendDate && latestSpendDate < range.to && (
        <div className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          ⓘ Latest spend recorded {latestSpendDate}; days after that have leads but no spend yet.
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-2 pr-3">Source</th>
              <th className="py-2 pr-3">Campaign</th>
              <th className="py-2 pr-3 text-right">Leads</th>
              <th className="py-2 pr-3 text-right">Qualified</th>
              <th className="py-2 pr-3 text-right">Hot</th>
              <th className="py-2 pr-3 text-right">Booked</th>
              <th className="py-2 pr-3 text-right">Revenue</th>
              <th className="py-2 pr-3 text-right">Spend</th>
              <th className="py-2 pr-3 text-right">CAC</th>
              <th className="py-2 pr-3 text-right">ROAS</th>
              <th className="py-2 pr-3 text-right">Conv</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="py-6 text-center text-neutral-400">
                  No leads in this range.
                </td>
              </tr>
            )}
            {rows.map((r: AttributionRow) => (
              <tr key={`${r.source} ${r.campaign}`} className="border-b">
                <td className="py-2 pr-3">{r.source}</td>
                <td className="py-2 pr-3">{r.campaign || "—"}</td>
                <td className="py-2 pr-3 text-right">{r.leads}</td>
                <td className="py-2 pr-3 text-right">{r.qualified}</td>
                <td className="py-2 pr-3 text-right">{r.hot}</td>
                <td className="py-2 pr-3 text-right">{r.booked}</td>
                <td className="py-2 pr-3 text-right">{rupees(r.revenue_paise)}</td>
                <td className="py-2 pr-3 text-right">{rupees(r.spend_paise)}</td>
                <td className="py-2 pr-3 text-right">{fmtCac(r.cac_paise)}</td>
                <td className="py-2 pr-3 text-right">{fmtRoas(r.roas)}</td>
                <td className="py-2 pr-3 text-right">{fmtConv(r.conv_rate)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="py-2 pr-3" colSpan={2}>
                Total
              </td>
              <td className="py-2 pr-3 text-right">{totals.leads}</td>
              <td className="py-2 pr-3 text-right">{totals.qualified}</td>
              <td className="py-2 pr-3 text-right">{totals.hot}</td>
              <td className="py-2 pr-3 text-right">{totals.booked}</td>
              <td className="py-2 pr-3 text-right">{rupees(totals.revenue_paise)}</td>
              <td className="py-2 pr-3 text-right">{rupees(totals.spend_paise)}</td>
              <td className="py-2 pr-3 text-right">{fmtCac(totals.cac_paise)}</td>
              <td className="py-2 pr-3 text-right">{fmtRoas(totals.roas)}</td>
              <td className="py-2 pr-3 text-right">{fmtConv(totals.conv_rate)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </main>
  );
}
