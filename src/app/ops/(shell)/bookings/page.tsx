import Link from "next/link";
import type { Metadata } from "next";
import { Search, Plus, SlidersHorizontal } from "lucide-react";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { formatIST } from "@/lib/time/formatIST";
import {
  BOOKING_STATUSES,
  SERVICE_CATEGORIES,
  type BookingStatus,
} from "../../_lib/bookingStatus";
import {
  bookingSection,
  WORKLIST_SECTION_ORDER,
  WORKLIST_SECTION_META,
  type WorklistSection,
} from "../../_lib/worklist";
import { BookingCard, type CardBooking } from "./BookingCard";

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
  booking_fee_paid_paise: number | null;
  balance_paid_paise: number | null;
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

function toCard(b: BookingRow): CardBooking {
  return {
    id: b.id,
    booking_code: b.booking_code,
    patient_name: b.patient_name,
    customer_name: b.customer?.full_name ?? null,
    customer_code: b.customer?.customer_code ?? null,
    phone: b.phone,
    service_category: b.service_category,
    status: b.status,
    amountRupees: rupeesFor(b),
    whenLabel: b.scheduled_for
      ? `Scheduled ${formatIST(b.scheduled_for)}`
      : `Booked ${formatIST(b.created_at)}`,
  };
}

// Mobile-first field classes — 16px text (no iOS zoom-on-focus), ≥44px tall,
// native controls. One place so every filter control matches.
const FIELD =
  "w-full min-h-[44px] bg-white border border-slate-300 rounded-xl px-3 text-base " +
  "focus:outline-none focus:ring-2 focus:ring-[#2B81FF] focus:border-transparent";
const LABEL =
  "block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1";

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
  const filtersActive = Boolean(q || status || service || from || to);

  const supabase = await createOpsRSCClient();

  let matchingCustomerIds: string[] = [];
  if (q) {
    const { data: matches } = await supabase
      .from("customers")
      .select("id")
      .or(`customer_code.ilike.%${q}%,full_name.ilike.%${q}%`)
      .limit(50);
    matchingCustomerIds = (matches ?? []).map((c) => c.id as string);
  }

  let query = supabase
    .from("bookings")
    .select(
      `id, booking_code, created_at, patient_name, phone, service_category,
       status, amount, final_amount_paise, test_total_paise,
       booking_fee_paid_paise, balance_paid_paise, payment_status,
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

  // Default view = triage grouped into the three fixed sections. When any
  // filter is active, flatten to a single result list so ops can also find
  // done/cancelled bookings (which fall out of triage).
  const grouped: Record<WorklistSection, BookingRow[]> = {
    needs_assignment: [],
    in_flight: [],
    balance_outstanding: [],
  };
  if (!filtersActive) {
    for (const b of bookings) {
      const s = bookingSection(b);
      if (s) grouped[s].push(b);
    }
  }

  return (
    <div className="px-4 py-5 md:px-8 md:py-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-4">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1">
          Operations
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Bookings</h1>
      </div>

      {/* New booking — full-width primary on mobile, inline on desktop. */}
      <Link
        href="/ops/bookings/new"
        className="w-full md:w-auto min-h-[48px] inline-flex items-center justify-center gap-2 bg-[#2B81FF] hover:bg-[#1E63D6] text-white text-[15px] font-semibold px-5 rounded-xl transition-colors mb-4"
      >
        <Plus className="w-5 h-5" />
        New booking
      </Link>

      {/* Filters — search always visible; the rest behind a native disclosure
          so the worklist stays above the fold on a phone. */}
      <form method="GET" className="bg-white border border-slate-200 rounded-2xl p-4 mb-6 space-y-3">
        <div>
          <label className={LABEL}>Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              name="q"
              defaultValue={q}
              inputMode="search"
              placeholder="Name, phone, SAN-C, SAN-B…"
              className={FIELD + " pl-9"}
            />
          </div>
        </div>

        <details open={Boolean(status || service || from || to)} className="group">
          <summary className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none min-h-[44px]">
            <SlidersHorizontal className="w-4 h-4" />
            More filters
          </summary>
          <div className="mt-3 space-y-3">
            <div>
              <label className={LABEL}>Status</label>
              <select name="status" defaultValue={status} className={FIELD}>
                <option value="">All</option>
                {BOOKING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>Service</label>
              <select name="service" defaultValue={service} className={FIELD}>
                <option value="">All</option>
                {SERVICE_CATEGORIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>From</label>
                <input type="date" name="from" defaultValue={from} className={FIELD} />
              </div>
              <div>
                <label className={LABEL}>To</label>
                <input type="date" name="to" defaultValue={to} className={FIELD} />
              </div>
            </div>
          </div>
        </details>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="flex-1 md:flex-none min-h-[44px] bg-slate-900 hover:bg-slate-800 text-white text-[15px] font-semibold px-5 rounded-xl transition-colors"
          >
            Apply
          </button>
          {filtersActive && (
            <Link
              href="/ops/bookings"
              className="min-h-[44px] inline-flex items-center text-sm text-slate-500 hover:text-slate-900 px-2"
            >
              Clear
            </Link>
          )}
        </div>
      </form>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl px-4 py-3 mb-4">
          Could not load bookings: {error.message}
        </div>
      )}

      {filtersActive ? (
        <FlatResults bookings={bookings} />
      ) : (
        WORKLIST_SECTION_ORDER.map((sectionKey) => (
          <WorklistSectionBlock
            key={sectionKey}
            sectionKey={sectionKey}
            rows={grouped[sectionKey]}
          />
        ))
      )}
    </div>
  );
}

function WorklistSectionBlock({
  sectionKey,
  rows,
}: {
  sectionKey: WorklistSection;
  rows: BookingRow[];
}) {
  const meta = WORKLIST_SECTION_META[sectionKey];
  return (
    <section className="mb-8">
      {/* Sticky header — stays pinned while the founder scrolls a long list. */}
      <div className="sticky top-0 z-10 -mx-4 md:-mx-8 px-4 md:px-8 py-2 bg-slate-50/95 backdrop-blur border-b border-slate-200">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-bold text-slate-900">{meta.title}</h2>
          <span className="text-[11px] font-mono text-slate-500">{rows.length}</span>
        </div>
        <p className="text-[11px] text-slate-500 mt-0.5">{meta.blurb}</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 px-1 py-6">All clear.</p>
      ) : (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map((b) => (
            <BookingCard key={b.id} b={toCard(b)} />
          ))}
        </div>
      )}
    </section>
  );
}

function FlatResults({ bookings }: { bookings: BookingRow[] }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-sm font-bold text-slate-900">Results</h2>
        <span className="text-[11px] font-mono text-slate-500">
          {bookings.length}
          {bookings.length === 200 && " · latest 200"}
        </span>
      </div>
      {bookings.length === 0 ? (
        <p className="text-sm text-slate-400 py-6">No bookings match the current filters.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {bookings.map((b) => (
            <BookingCard key={b.id} b={toCard(b)} />
          ))}
        </div>
      )}
    </section>
  );
}
