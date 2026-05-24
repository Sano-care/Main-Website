import { rupees } from "@/lib/doctorFinance";
import type { DoctorLedgerEntryWithBalance } from "../_lib/doctorData";

/**
 * Read-only ledger render for the doctor's own view. Same column shape as
 * /ops/doctors/[id]'s ledger, but every per-entry "booking →" link from
 * the ops view is omitted (the doctor doesn't have a booking detail
 * surface in C1).
 *
 * Entries are passed newest-first; running balance is pre-computed by
 * the caller via a forward walk over the oldest-first slice.
 */
const ENTRY_TYPE_STYLE: Record<DoctorLedgerEntryWithBalance["entry_type"], string> = {
  revenue_share: "bg-emerald-100 text-emerald-800",
  commission: "bg-emerald-100 text-emerald-800",
  daily_wage: "bg-blue-100 text-blue-800",
  overtime: "bg-violet-100 text-violet-800",
  payout: "bg-rose-100 text-rose-800",
  adjustment: "bg-amber-100 text-amber-800",
  reversal: "bg-slate-200 text-slate-700",
};

export function DoctorLedgerTable({
  entries,
}: {
  entries: DoctorLedgerEntryWithBalance[];
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-baseline justify-between">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
          Ledger
        </div>
        <div className="text-xs text-slate-500">
          {entries.length} entries · append-only · newest first
        </div>
      </div>
      {entries.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-slate-500">
          No entries yet. Earnings post here automatically when a booking you&apos;re
          assigned to reaches COMPLETED, when ops marks your attendance, or when
          a payout / adjustment is recorded.
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
              {entries.map((e) => {
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
  );
}
