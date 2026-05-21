import Link from "next/link";
import type { Metadata } from "next";
import { Search, Plus } from "lucide-react";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import {
  BOOKING_STATUSES,
  SERVICE_CATEGORIES,
  STATUS_STYLE,
  PAYMENT_STATUS_STYLE,
  type BookingStatus,
} from "../../_lib/bookingStatus";

export const metadata: Metadata = {
  title: "Ops · Bookings",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type BookingRow = {
  id: string;
  booking_code: string | null;
  created_at: string;
  patient_name: string;
  phone: string | null;
  service_category: string | null;
  status: BookingStatus;
  amount: number | null;
  final_amount_paise: number | null;
  test_total_paise: number | null;
  payment_status: string | null;
  scheduled_for: string | null;
  customer_id: string | null;
  partner_id: string | null;
  customer: { id: string; customer_code: string; full_name: string } | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeSearch(q: string): string {
  return q.replace(/[%,()]/g, "").trim().slice(0, 100);
}

function rupeesFor(b: BookingRow): number | null {
  if (b.final_amount_paise != null) return b.final_amount_paise / 100;
  if (b.test_total_paise != null) return b.test_total_paise / 100;
  if (b.amount != null) return b.amount;
  return null;
}

export default async function BookingsListPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    service?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const sp = await searchParams;
  const q = sanitizeSearch(sp.q ?? "");
  const status = sp.status ?? "";
  const service = sp.service ?? "";
  const from = sp.from ?? "";
  const to = sp.to ?? "";

  const supabase = await createOpsRSCClient();

  // Step 1: if there's a search, look up customers whose code or name match.
  // We use this to pull bookings linked to those customers even if the inline
  // patient_name doesn't match.
  let matchingCustomerIds: string[] = [];
  if (q) {
    const { data: matches } = await supabase
      .from("customers")
      .select("id")
      .or(`customer_code.ilike.%${q}%,full_name.ilike.%${q}%`)
      .limit(50);
    matchingCustomerIds = (matches ?? []).map((c) => c.id as string);
  }

  // Step 2: build the bookings query.
  let query = supabase
    .from("bookings")
    .select(
      `id, booking_code, created_at, patient_name, phone, service_category,
       status, amount, final_amount_paise, test_total_paise, payment_status,
       scheduled_for, customer_id, partner_id,
       customer:customers ( id, customer_code, full_name )`,
    );

  if (status) query = query.eq("status", status);
  if (service) query = query.eq("service_category", service);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", `${to}T23:59:59.999Z`);

  if (q) {
    const parts: string[] = [
      `patient_name.ilike.%${q}%`,
      `phone.ilike.%${q}%`,
      `booking_code.ilike.%${q}%`,
    ];
    if (UUID_RE.test(q)) parts.push(`id.eq.${q}`);
    if (matchingCustomerIds.length) {
      parts.push(`customer_id.in.(${matchingCustomerIds.join(",")})`);
    }
    query = query.or(parts.join(","));
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(200);

  const bookings = (data as BookingRow[] | null) ?? [];

  return (
    <div className="px-8 py-8">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1">
            Operations
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Bookings</h1>
          <p className="text-sm text-slate-600 mt-1">
            {bookings.length} record{bookings.length === 1 ? "" : "s"}
            {bookings.length === 200 && " · showing latest 200"}
          </p>
        </div>
        <Link
          href="/ops/bookings/new"
          className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New booking
        </Link>
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
                placeholder="Name, phone, SAN-C, SAN-B, or full booking id…"
                className="w-full bg-white border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
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
              {BOOKING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              Service
            </label>
            <select
              name="service"
              defaultValue={service}
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            >
              <option value="">All</option>
              {SERVICE_CATEGORIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
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
          {(q || status || service || from || to) && (
            <Link
              href="/ops/bookings"
              className="text-sm text-slate-500 hover:text-slate-900"
            >
              Clear filters
            </Link>
          )}
        </div>
      </form>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-3 mb-4">
          Could not load bookings: {error.message}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {bookings.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-500">
            No bookings match the current filters.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left">
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Booking
                </th>
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Customer
                </th>
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Service
                </th>
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Status
                </th>
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Payment
                </th>
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500 text-right">
                  Amount
                </th>
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bookings.map((b) => {
                const rupees = rupeesFor(b);
                const displayName =
                  b.customer?.full_name ?? b.patient_name ?? "—";
                const code = b.customer?.customer_code;
                return (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/ops/bookings/${b.id}`}
                        className="font-mono text-sm font-semibold text-slate-900 hover:text-primary underline whitespace-nowrap"
                      >
                        {b.booking_code ?? `#${b.id.slice(0, 8)}`}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{displayName}</div>
                      <div className="text-xs text-slate-500">
                        {code && (
                          <span className="font-mono">{code}</span>
                        )}
                        {code && b.phone && " · "}
                        {b.phone}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {b.service_category ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          "inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full " +
                          (STATUS_STYLE[b.status] ?? "bg-slate-100 text-slate-700")
                        }
                      >
                        {b.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {b.payment_status ? (
                        <span
                          className={
                            "inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full " +
                            (PAYMENT_STATUS_STYLE[b.payment_status] ?? "bg-slate-100 text-slate-700")
                          }
                        >
                          {b.payment_status}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900">
                      {rupees != null ? `₹${rupees.toLocaleString("en-IN")}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(b.created_at).toLocaleString("en-IN")}
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
