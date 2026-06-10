import Link from "next/link";
import type { Metadata } from "next";
import { Search, ArrowRight } from "lucide-react";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { formatIST } from "@/lib/time/formatIST";

export const metadata: Metadata = {
  title: "Ops · Payments",
  robots: { index: false, follow: false },
};

// Belt-and-suspenders across every cache layer — payments are live
// reconciliation state, never statically renderable. Matches the M2.7
// detail-page fix pattern.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type PaymentRow = {
  booking_id: string;
  booking_code: string;
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string | null;
  service_category: string | null;
  booking_status: string;
  payment_kind: "booking_fee" | "report_fee";
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  amount_paise: number;
  status: string | null;
  captured_at: string | null;
  created_at: string;
};

// Union of every status value across both payment lanes. The view
// preserves the original casing from bookings.payment_status (UPPERCASE
// from M007) and bookings.report_payment_status (UPPERCASE from M008).
const ALL_STATUSES = [
  "CREATED",
  "CAPTURED",
  "FAILED",
  "REFUNDED",
  "PARTIAL_REFUND",
  "NOT_DUE",
  "LINK_SENT",
] as const;

const STATUS_STYLE: Record<string, string> = {
  CREATED: "bg-slate-100 text-slate-700",
  CAPTURED: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-rose-100 text-rose-800",
  REFUNDED: "bg-amber-100 text-amber-800",
  PARTIAL_REFUND: "bg-amber-100 text-amber-800",
  NOT_DUE: "bg-slate-100 text-slate-500",
  LINK_SENT: "bg-blue-100 text-blue-800",
};

const KIND_LABEL: Record<PaymentRow["payment_kind"], string> = {
  booking_fee: "Booking fee",
  report_fee: "Report fee",
};

function sanitizeSearch(q: string): string {
  // Same defensive strip as the bookings/patients lists — keep PostgREST
  // .or() safe + cap length.
  return q.replace(/[%,()]/g, "").trim().slice(0, 100);
}

export default async function PaymentsListPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    reconciled?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const sp = await searchParams;
  const q = sanitizeSearch(sp.q ?? "");
  const status = sp.status ?? "";
  const reconciled = sp.reconciled ?? "";
  const from = sp.from ?? "";
  const to = sp.to ?? "";

  const supabase = await createOpsRSCClient();

  let query = supabase
    .from("payments_v")
    .select(
      `booking_id, booking_code, customer_id, customer_code, customer_name,
       service_category, booking_status, payment_kind, razorpay_order_id,
       razorpay_payment_id, amount_paise, status, captured_at, created_at`,
    );

  if (status) query = query.eq("status", status);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", `${to}T23:59:59.999Z`);
  if (reconciled === "yes") query = query.not("customer_id", "is", null);
  if (reconciled === "no") query = query.is("customer_id", null);

  if (q) {
    // payment id / order id / booking code — exact-ish matches.
    query = query.or(
      `razorpay_payment_id.ilike.%${q}%,razorpay_order_id.ilike.%${q}%,booking_code.ilike.%${q}%`,
    );
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(200);

  const payments = (data as PaymentRow[] | null) ?? [];

  return (
    <div className="px-8 py-8">
      <div className="mb-6">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1">
          Finance
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Payments</h1>
        <p className="text-sm text-slate-600 mt-1">
          {payments.length} record{payments.length === 1 ? "" : "s"}
          {payments.length === 200 && " · showing latest 200"} · reconciliation
          mirror of Razorpay (read from <span className="font-mono">payments_v</span>)
        </p>
      </div>

      <form className="bg-white border border-slate-200 rounded-2xl p-4 mb-6" method="GET">
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
                placeholder="pay_…  order_…  SAN-B-…"
                className="w-full bg-white border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm font-mono placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              Status
            </label>
            <select
              name="status"
              defaultValue={status}
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            >
              <option value="">All</option>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              Customer
            </label>
            <select
              name="reconciled"
              defaultValue={reconciled}
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            >
              <option value="">All</option>
              <option value="yes">Reconciled</option>
              <option value="no">Unreconciled</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
                From
              </label>
              <input
                type="date"
                name="from"
                defaultValue={from}
                className="w-full bg-white border border-slate-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
                To
              </label>
              <input
                type="date"
                name="to"
                defaultValue={to}
                className="w-full bg-white border border-slate-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button
            type="submit"
            className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Apply
          </button>
          {(q || status || reconciled || from || to) && (
            <Link href="/ops/payments" className="text-sm text-slate-500 hover:text-slate-900">
              Clear filters
            </Link>
          )}
        </div>
      </form>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-3 mb-4">
          Could not load payments: {error.message}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {payments.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-500">
            No payments match the current filters.
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
                    Payment / Order
                  </th>
                  <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500 text-right">
                    Amount
                  </th>
                  <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                    Status
                  </th>
                  <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                    Lane
                  </th>
                  <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                    Booking / Customer
                  </th>
                  <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((p) => {
                  const detailHref = `/ops/payments/${p.booking_code}/${p.payment_kind}`;
                  return (
                    <tr key={`${p.booking_id}-${p.payment_kind}`} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                        {formatIST(p.created_at)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-mono text-xs text-slate-900">
                          {p.razorpay_payment_id
                            ? p.razorpay_payment_id.slice(0, 16) +
                              (p.razorpay_payment_id.length > 16 ? "…" : "")
                            : "—"}
                        </div>
                        <div className="font-mono text-[10px] text-slate-500">
                          {p.razorpay_order_id ?? "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900 whitespace-nowrap">
                        ₹{(p.amount_paise / 100).toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {p.status ? (
                          <span
                            className={
                              "inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full " +
                              (STATUS_STYLE[p.status] ?? "bg-slate-100 text-slate-700")
                            }
                          >
                            {p.status}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700 whitespace-nowrap">
                        {KIND_LABEL[p.payment_kind]}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link
                          href={`/ops/bookings/${p.booking_id}`}
                          className="font-mono text-xs text-slate-900 hover:text-primary underline"
                        >
                          {p.booking_code}
                        </Link>
                        <div className="text-xs text-slate-500">
                          {p.customer_id ? (
                            <>
                              <span className="font-mono">{p.customer_code}</span>
                              {" · "}
                              {p.customer_name}
                            </>
                          ) : (
                            <span className="inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                              Unreconciled
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={detailHref}
                          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
                        >
                          Open
                          <ArrowRight className="w-3 h-3" />
                        </Link>
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
