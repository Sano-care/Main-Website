import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import {
  BOOKING_STATUSES,
  STATUS_STYLE,
  PAYMENT_STATUS_STYLE,
  type BookingStatus,
} from "../../../_lib/bookingStatus";
import {
  changeStatus,
  reschedule,
  cancelBooking,
  saveOpsNotes,
  linkCustomer,
  linkPartner,
  assignDoctor,
  assignParamedic,
  assignPartner,
} from "../actions";

export const metadata: Metadata = {
  title: "Ops · Booking detail",
  robots: { index: false, follow: false },
};

// Per-request, RLS-gated, never statically cached. Belt-and-suspenders
// across every Next.js cache layer:
//   - dynamic: 'force-dynamic'      — opt out of static rendering
//   - revalidate: 0                  — disable any ISR window
//   - fetchCache: 'force-no-store'   — Supabase reads inside this segment
//                                      go straight to the database every
//                                      time. Without this, a fresh booking
//                                      created via /ops/bookings/new can
//                                      404 because the in-segment fetch
//                                      gets served from cache.
// Also: no generateStaticParams and no dynamicParams = false — both would
// reintroduce build-time pre-rendering.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type BookingDetail = {
  id: string;
  booking_code: string | null;
  created_at: string;
  patient_name: string;
  phone: string | null;
  service_category: string | null;
  specific_ailment: string | null;
  manual_address: string | null;
  status: BookingStatus;
  amount: number | null;
  final_amount_paise: number | null;
  test_total_paise: number | null;
  payment_status: string | null;
  report_payment_status: string | null;
  scheduled_for: string | null;
  assigned_at: string | null;
  dispatched_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  notes: string | null;
  ops_notes: string | null;
  customer_id: string | null;
  partner_id: string | null;
  doctor_id: string | null;
  // M032 — Ops Framework Phase 1 assignment + audit columns
  assigned_paramedic_id: string | null;
  assigned_partner_id: string | null;
  assigned_by: string | null;
  customer: {
    id: string;
    customer_code: string;
    full_name: string;
    phone: string | null;
    email: string | null;
  } | null;
  partner: {
    id: string;
    partner_code: string;
    name: string;
    partner_type: string;
  } | null;
  doctor: {
    id: string;
    doctor_code: string;
    full_name: string;
    doctor_type: "freelancer" | "salaried";
  } | null;
  // M032: assigned-resource joins
  paramedic: {
    id: string;
    name: string;
    phone: string | null;
    specialty: string | null;
  } | null;
  assigned_partner: {
    id: string;
    partner_code: string;
    name: string;
    partner_type: string;
  } | null;
  assigned_by_user: {
    id: string;
    full_name: string;
  } | null;
};

type ActiveDoctor = {
  id: string;
  doctor_code: string;
  full_name: string;
  doctor_type: "freelancer" | "salaried";
};

type ActiveParamedic = {
  id: string;
  name: string;
  phone: string | null;
  specialty: string | null;
};

type ActivePartner = {
  id: string;
  partner_code: string;
  name: string;
  partner_type: string;
};

// M032 — Ops Framework Phase 1: maps service_category to which
// resource pickers should render on the booking detail page. Two
// non-canonical labels in the brief ("nursing", "pathology") are
// mapped onto canonical SERVICE_CATEGORIES values: chronic and
// diagnostics respectively.
function pickersFor(serviceCategory: string | null): {
  doctor: boolean;
  paramedic: boolean;
  partner: boolean;
} {
  switch (serviceCategory) {
    case "teleconsult":
      return { doctor: true, paramedic: false, partner: false };
    case "homecare":
      return { doctor: true, paramedic: true, partner: false };
    case "chronic":
      return { doctor: true, paramedic: true, partner: false };
    case "diagnostics":
      return { doctor: false, paramedic: false, partner: true };
    default:
      return { doctor: false, paramedic: false, partner: false };
  }
}

function rupeesFor(b: BookingDetail): number | null {
  if (b.final_amount_paise != null) return b.final_amount_paise / 100;
  if (b.test_total_paise != null) return b.test_total_paise / 100;
  if (b.amount != null) return b.amount;
  return null;
}

// Convert an ISO timestamp into the value an <input type="datetime-local">
// expects: "YYYY-MM-DDTHH:mm" in *local* time. Returns "" for nulls.
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createOpsRSCClient();

  // M032: load assignment columns + joined paramedic / assigned-partner /
  // assigned-by-ops-user, plus active pickers for all three resource types.
  // Parallel-fetched so the detail page is one round-trip wide.
  const [
    { data },
    { data: doctorsData },
    { data: paramedicsData },
    { data: partnersData },
  ] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        `id, booking_code, created_at, patient_name, phone, service_category,
         specific_ailment, manual_address, status, amount, final_amount_paise,
         test_total_paise, payment_status, report_payment_status, scheduled_for,
         assigned_at, dispatched_at, completed_at, cancelled_at,
         cancellation_reason, notes, ops_notes, customer_id, partner_id, doctor_id,
         assigned_paramedic_id, assigned_partner_id, assigned_by,
         customer:customers ( id, customer_code, full_name, phone, email ),
         partner:partners!partner_id ( id, partner_code, name, partner_type ),
         doctor:doctors ( id, doctor_code, full_name, doctor_type ),
         paramedic:paramedics!assigned_paramedic_id ( id, name, phone, specialty ),
         assigned_partner:partners!assigned_partner_id ( id, partner_code, name, partner_type ),
         assigned_by_user:ops_users!assigned_by ( id, full_name )`,
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("doctors")
      .select("id, doctor_code, full_name, doctor_type")
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
    supabase
      .from("paramedics")
      .select("id, name, phone, specialty")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("partners")
      .select("id, partner_code, name, partner_type")
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  const booking = data as BookingDetail | null;
  if (!booking) notFound();
  const activeDoctors = (doctorsData as ActiveDoctor[] | null) ?? [];
  const activeParamedics = (paramedicsData as ActiveParamedic[] | null) ?? [];
  const activePartners = (partnersData as ActivePartner[] | null) ?? [];
  const pickers = pickersFor(booking.service_category);

  const rupees = rupeesFor(booking);
  const isCancelled = booking.status === "CANCELLED";
  const isTerminal =
    booking.status === "COMPLETED" ||
    booking.status === "REPORT_DELIVERED" ||
    booking.status === "CANCELLED";

  return (
    <div className="px-8 py-8 max-w-5xl">
      <Link
        href="/ops/bookings"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to bookings
      </Link>

      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="flex items-baseline gap-3 flex-wrap mb-2">
            <span className="font-mono text-lg font-semibold text-slate-900">
              {booking.booking_code ?? "—"}
            </span>
            <span
              className={
                "inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full " +
                (STATUS_STYLE[booking.status] ?? "bg-slate-100 text-slate-700")
              }
            >
              {booking.status.replace(/_/g, " ")}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            {booking.customer?.full_name ?? booking.patient_name}
          </h1>
          <div className="text-sm text-slate-600 mt-1">
            Created {new Date(booking.created_at).toLocaleString("en-IN")}
            {booking.scheduled_for && (
              <>
                {" · Scheduled "}
                {new Date(booking.scheduled_for).toLocaleString("en-IN")}
              </>
            )}
          </div>
          <div className="font-mono text-[10px] text-slate-400 mt-2">
            uuid {booking.id}
          </div>
        </div>
      </div>

      {/* Snapshot — service, amount, payment, address */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-3">
          Snapshot
        </div>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <Field label="Service">{booking.service_category ?? "—"}</Field>
          <Field label="Specific ailment">
            {booking.specific_ailment ?? "—"}
          </Field>
          <Field label="Phone" mono>
            {booking.phone ?? "—"}
          </Field>
          <Field label="Amount">
            {rupees != null ? `₹${rupees.toLocaleString("en-IN")}` : "—"}
          </Field>
          <Field label="Booking payment">
            {booking.payment_status ? (
              <span
                className={
                  "inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full " +
                  (PAYMENT_STATUS_STYLE[booking.payment_status] ?? "bg-slate-100 text-slate-700")
                }
              >
                {booking.payment_status}
              </span>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Report payment">
            {booking.report_payment_status ? (
              <span
                className={
                  "inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full " +
                  (PAYMENT_STATUS_STYLE[booking.report_payment_status] ?? "bg-slate-100 text-slate-700")
                }
              >
                {booking.report_payment_status}
              </span>
            ) : (
              "—"
            )}
          </Field>
        </div>
        {booking.manual_address && (
          <div className="mt-5 pt-5 border-t border-slate-100">
            <div className="text-xs text-slate-500 mb-1">Address</div>
            <div className="text-sm text-slate-800 whitespace-pre-wrap">
              {booking.manual_address}
            </div>
          </div>
        )}
        {booking.notes && (
          <div className="mt-5 pt-5 border-t border-slate-100">
            <div className="text-xs text-slate-500 mb-1">
              Patient-facing notes
            </div>
            <div className="text-sm text-slate-800 whitespace-pre-wrap">
              {booking.notes}
            </div>
          </div>
        )}
      </div>

      {/* Linked customer */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-3">
          Linked customer
        </div>
        {booking.customer ? (
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <Link
                href={`/ops/patients/${booking.customer.id}`}
                className="text-base font-semibold text-slate-900 hover:text-primary underline"
              >
                {booking.customer.full_name}
              </Link>
              <div className="text-sm text-slate-500 mt-0.5">
                <span className="font-mono">{booking.customer.customer_code}</span>
                {booking.customer.phone && " · "}
                {booking.customer.phone}
                {booking.customer.email && " · "}
                {booking.customer.email}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-500">
            Not linked to a customer record.
          </div>
        )}
        <form action={linkCustomer} className="flex flex-wrap items-end gap-2 mt-4 pt-4 border-t border-slate-100">
          <input type="hidden" name="booking_id" value={booking.id} />
          <div className="grow min-w-[200px]">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              {booking.customer ? "Relink to customer" : "Link to customer"}
            </label>
            <input
              type="text"
              name="target"
              placeholder="SAN-C-00001 or full UUID, blank to unlink"
              defaultValue=""
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            />
          </div>
          <button
            type="submit"
            className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Save
          </button>
        </form>
      </div>

      {/* Linked partner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-3">
          Linked partner
        </div>
        {booking.partner ? (
          <div>
            <Link
              href={`/ops/partners/${booking.partner.id}`}
              className="text-base font-semibold text-slate-900 hover:text-primary underline"
            >
              {booking.partner.name}
            </Link>
            <div className="text-sm text-slate-500 mt-0.5">
              <span className="font-mono">{booking.partner.partner_code}</span>
              {" · "}
              {booking.partner.partner_type}
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-500">
            Not linked to a partner record.
          </div>
        )}
        <form action={linkPartner} className="flex flex-wrap items-end gap-2 mt-4 pt-4 border-t border-slate-100">
          <input type="hidden" name="booking_id" value={booking.id} />
          <div className="grow min-w-[200px]">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              {booking.partner ? "Relink to partner" : "Link to partner"}
            </label>
            <input
              type="text"
              name="target"
              placeholder="SAN-P-00001 or full UUID, blank to unlink"
              defaultValue=""
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            />
          </div>
          <button
            type="submit"
            className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Save
          </button>
        </form>
      </div>

      {/* Assignment audit strip — shown when ANY assignment is in
          place, summarising the latest assigned_at + assigned_by.
          The (assigned_at, assigned_by) audit columns are most-recent
          across all roles per Phase-3 flag from founder (any role
          touched). */}
      {(booking.doctor || booking.paramedic || booking.assigned_partner) &&
        booking.assigned_at && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2 mb-6 text-[11px] text-slate-600">
            Last assignment{" "}
            <span className="font-mono">
              {new Intl.DateTimeFormat("en-IN", {
                timeZone: "Asia/Kolkata",
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              }).format(new Date(booking.assigned_at))}
            </span>
            {booking.assigned_by_user
              ? <> by <span className="font-medium">{booking.assigned_by_user.full_name}</span></>
              : null}
          </div>
        )}

      {/* Assigned doctor — added in M4. Any ops user can assign; the
          revenue_share / commission auto-post happens later when status
          flips to COMPLETED via the M019 trigger.
          M032: only rendered when service_category allows a doctor
          (teleconsult / homecare / chronic). */}
      {pickers.doctor && (
      <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-3">
          Assigned doctor
        </div>
        {booking.doctor ? (
          <div>
            <Link
              href={`/ops/doctors/${booking.doctor.id}`}
              className="text-base font-semibold text-slate-900 hover:text-primary underline"
            >
              {booking.doctor.full_name}
            </Link>
            <div className="text-sm text-slate-500 mt-0.5">
              <span className="font-mono">{booking.doctor.doctor_code}</span>
              {" · "}
              {booking.doctor.doctor_type}
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-500">
            No doctor assigned yet.
          </div>
        )}
        <form action={assignDoctor} className="flex flex-wrap items-end gap-2 mt-4 pt-4 border-t border-slate-100">
          <input type="hidden" name="booking_id" value={booking.id} />
          <div className="grow min-w-[260px]">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              {booking.doctor ? "Reassign" : "Assign doctor"}
            </label>
            <select
              name="doctor_id"
              defaultValue={booking.doctor_id ?? ""}
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            >
              <option value="">— Unassigned —</option>
              {activeDoctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.doctor_code} · {d.full_name} ({d.doctor_type})
                </option>
              ))}
            </select>
            {activeDoctors.length === 0 && (
              <p className="text-[11px] text-slate-500 mt-1">
                No active doctors. Add one from{" "}
                <Link href="/ops/doctors" className="underline">
                  /ops/doctors
                </Link>
                .
              </p>
            )}
          </div>
          <button
            type="submit"
            className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Save
          </button>
        </form>
        {booking.status !== "COMPLETED" && booking.doctor && (
          <p className="text-[11px] text-slate-500 mt-3">
            Earning will post to the doctor&apos;s ledger when this booking
            is marked <span className="font-mono">COMPLETED</span>.
          </p>
        )}
      </div>
      )}

      {/* Assigned medic (paramedics table; UI label "Medic" per Q3) —
          shown for homecare + chronic. Mirrors the doctor block shape. */}
      {pickers.paramedic && (
      <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-3">
          Assigned medic
        </div>
        {booking.paramedic ? (
          <div>
            <div className="text-base font-semibold text-slate-900">
              {booking.paramedic.name}
            </div>
            <div className="text-sm text-slate-500 mt-0.5">
              {booking.paramedic.phone ?? "—"}
              {booking.paramedic.specialty && (
                <>
                  {" · "}
                  {booking.paramedic.specialty}
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-500">
            No medic assigned yet.
          </div>
        )}
        <form
          action={assignParamedic}
          className="flex flex-wrap items-end gap-2 mt-4 pt-4 border-t border-slate-100"
        >
          <input type="hidden" name="booking_id" value={booking.id} />
          <div className="grow min-w-[260px]">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              {booking.paramedic ? "Reassign" : "Assign medic"}
            </label>
            <select
              name="paramedic_id"
              defaultValue={booking.assigned_paramedic_id ?? ""}
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            >
              <option value="">— Unassigned —</option>
              {activeParamedics.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.specialty ? ` (${p.specialty})` : ""}
                </option>
              ))}
            </select>
            {activeParamedics.length === 0 && (
              <p className="text-[11px] text-slate-500 mt-1">
                No active medics on file. Add via SQL or the future
                /ops/medics admin (Phase 3).
              </p>
            )}
          </div>
          <button
            type="submit"
            className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Save
          </button>
        </form>
      </div>
      )}

      {/* Assigned partner — for diagnostics only. Distinct from the
          general-purpose "Link partner" block above which manages the
          legacy bookings.partner_id column for any service. */}
      {pickers.partner && (
      <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-3">
          Assigned partner (fulfillment)
        </div>
        {booking.assigned_partner ? (
          <div>
            <div className="text-base font-semibold text-slate-900">
              {booking.assigned_partner.name}
            </div>
            <div className="text-sm text-slate-500 mt-0.5">
              <span className="font-mono">
                {booking.assigned_partner.partner_code}
              </span>
              {" · "}
              {booking.assigned_partner.partner_type}
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-500">
            No partner assigned for fulfillment yet.
          </div>
        )}
        <form
          action={assignPartner}
          className="flex flex-wrap items-end gap-2 mt-4 pt-4 border-t border-slate-100"
        >
          <input type="hidden" name="booking_id" value={booking.id} />
          <div className="grow min-w-[260px]">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              {booking.assigned_partner ? "Reassign" : "Assign partner"}
            </label>
            <select
              name="partner_id"
              defaultValue={booking.assigned_partner_id ?? ""}
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            >
              <option value="">— Unassigned —</option>
              {activePartners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.partner_code} · {p.name} ({p.partner_type})
                </option>
              ))}
            </select>
            {activePartners.length === 0 && (
              <p className="text-[11px] text-slate-500 mt-1">
                No active partners. Add one from{" "}
                <Link href="/ops/partners" className="underline">
                  /ops/partners
                </Link>
                .
              </p>
            )}
          </div>
          <button
            type="submit"
            className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Save
          </button>
        </form>
      </div>
      )}

      {/* Actions: status, schedule, cancel */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-3">
            Change status
          </div>
          <form action={changeStatus} className="space-y-3">
            <input type="hidden" name="booking_id" value={booking.id} />
            <select
              name="status"
              defaultValue={booking.status}
              disabled={isCancelled}
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            >
              {BOOKING_STATUSES.filter((s) => s !== "CANCELLED").map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={isCancelled}
              className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              Update status
            </button>
            {isCancelled && (
              <p className="text-xs text-slate-500">
                This booking has been cancelled and cannot transition further.
              </p>
            )}
          </form>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-3">
            Schedule
          </div>
          <form action={reschedule} className="space-y-3">
            <input type="hidden" name="booking_id" value={booking.id} />
            <input
              type="datetime-local"
              name="scheduled_for"
              defaultValue={toLocalInput(booking.scheduled_for)}
              disabled={isCancelled}
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            />
            <button
              type="submit"
              disabled={isCancelled}
              className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              Save schedule
            </button>
            <p className="text-xs text-slate-500">
              Leave blank and save to clear the scheduled time.
            </p>
          </form>
        </div>
      </div>

      {/* C2-Rx: prescriptions linked to this booking. Lists every Rx
          (across versions) so ops can resend or jump into a detail
          surface. Most bookings have zero or one; teleconsult chains
          with amend may have more. */}
      <BookingPrescriptionsSection bookingId={booking.id} />

      {/* Ops notes */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-3">
          Ops notes (internal)
        </div>
        <form action={saveOpsNotes} className="space-y-3">
          <input type="hidden" name="booking_id" value={booking.id} />
          <textarea
            name="ops_notes"
            rows={4}
            defaultValue={booking.ops_notes ?? ""}
            placeholder="Anything ops needs to remember about this booking. Never shown to patients."
            className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
          />
          <button
            type="submit"
            className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Save notes
          </button>
        </form>
      </div>

      {/* Cancel */}
      {!isCancelled ? (
        <div className="bg-white border border-rose-200 rounded-2xl p-6 mb-6">
          <div className="text-[11px] font-mono uppercase tracking-wider text-rose-600 mb-3">
            Cancel booking
          </div>
          <form action={cancelBooking} className="space-y-3">
            <input type="hidden" name="booking_id" value={booking.id} />
            <textarea
              name="cancellation_reason"
              required
              rows={3}
              placeholder="Why is this booking being cancelled? (required)"
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-600 focus:border-transparent"
            />
            <button
              type="submit"
              className="bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              Cancel booking
            </button>
            <p className="text-xs text-slate-500">
              Sets status to <span className="font-mono">CANCELLED</span> and
              stamps <span className="font-mono">cancelled_at</span>. Does not
              issue a Razorpay refund — do that separately via the Payments
              flow when it ships.
            </p>
          </form>
        </div>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 mb-6">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1">
            Cancellation
          </div>
          <div className="text-sm text-slate-800">
            Cancelled{" "}
            {booking.cancelled_at
              ? new Date(booking.cancelled_at).toLocaleString("en-IN")
              : "(no timestamp)"}
          </div>
          {booking.cancellation_reason && (
            <div className="text-sm text-slate-700 mt-2 whitespace-pre-wrap">
              {booking.cancellation_reason}
            </div>
          )}
        </div>
      )}

      {/* Timeline */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-3">
          Timeline
        </div>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <Stamp label="Created" iso={booking.created_at} />
          <Stamp label="Scheduled for" iso={booking.scheduled_for} />
          <Stamp label="Assigned" iso={booking.assigned_at} />
          <Stamp label="Dispatched" iso={booking.dispatched_at} />
          <Stamp label="Completed" iso={booking.completed_at} />
          <Stamp label="Cancelled" iso={booking.cancelled_at} />
        </div>
        {isTerminal && (
          <p className="text-xs text-slate-500 mt-3">
            This booking is in a terminal state.
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  mono,
  children,
}: {
  label: string;
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={"text-slate-900 " + (mono ? "font-mono text-sm" : "")}>
        {children}
      </div>
    </div>
  );
}

function Stamp({ label, iso }: { label: string; iso: string | null }) {
  return (
    <div>
      <span className="text-xs text-slate-500">{label}: </span>
      <span className="text-sm text-slate-800">
        {iso ? new Date(iso).toLocaleString("en-IN") : "—"}
      </span>
    </div>
  );
}


// =====================================================================
// C2-Rx — Prescriptions linked to this booking
//
// Renders an inline list of every Rx (across versions and statuses) for
// the given booking. Each row links to /ops/prescriptions/[code] for
// the full ops view (resend WhatsApp / download PDF). Server component;
// no client interactivity needed here — actions live on the detail
// page.
// =====================================================================
type BookingRxRow = {
  id: string;
  prescription_code: string;
  version: number;
  status: "draft" | "sent" | "superseded" | "voided";
  sent_at: string | null;
  created_at: string;
  whatsapp_sent_at: string | null;
  patient_view_token: string | null;
  doctor: { full_name: string } | null;
};

async function BookingPrescriptionsSection({
  bookingId,
}: {
  bookingId: string;
}) {
  const supabase = await createOpsRSCClient();
  const { data, error } = await supabase
    .from("prescriptions")
    .select(
      "id, prescription_code, version, status, sent_at, created_at, whatsapp_sent_at, patient_view_token, doctor:doctors!doctor_id(full_name)",
    )
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false });

  const rows = (data as unknown as BookingRxRow[] | null) ?? [];

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
          Prescriptions ({rows.length})
        </div>
      </div>
      {error ? (
        <div className="text-sm text-rose-700">
          Could not load prescriptions: {error.message}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-slate-400">
          No prescriptions issued for this booking yet.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li
              key={r.id}
              className="py-2 flex items-center justify-between gap-3 flex-wrap"
            >
              <div className="min-w-0">
                <Link
                  href={`/ops/prescriptions/${r.prescription_code}${
                    r.version > 1 ? `?v=${r.version}` : ""
                  }`}
                  className="font-mono text-sm text-slate-900 hover:underline"
                >
                  {r.prescription_code}
                  {r.version > 1 && (
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 ml-1">
                      v{r.version}
                    </span>
                  )}
                </Link>
                <span className="ml-2 text-xs text-slate-500">
                  by {r.doctor?.full_name ?? "—"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span
                  className={
                    "inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full " +
                    (r.status === "sent"
                      ? "bg-emerald-100 text-emerald-800"
                      : r.status === "draft"
                        ? "bg-amber-100 text-amber-800"
                        : r.status === "voided"
                          ? "bg-rose-100 text-rose-800"
                          : "bg-slate-100 text-slate-700")
                  }
                >
                  {r.status}
                </span>
                {r.status === "sent" && (
                  r.whatsapp_sent_at ? (
                    <span className="text-emerald-700">WhatsApp ✓</span>
                  ) : (
                    <span className="text-amber-700">delivery pending</span>
                  )
                )}
                <span className="text-slate-500">
                  {new Date(r.sent_at ?? r.created_at).toLocaleString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

