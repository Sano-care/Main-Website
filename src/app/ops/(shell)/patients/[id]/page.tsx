import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { ProfileCard } from "./ProfileCard";

export const metadata: Metadata = {
  title: "Ops · Patient detail",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Customer = {
  id: string;
  customer_code: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  date_of_birth: string | null;
  gender: string | null;
  address_line: string | null;
  area: string | null;
  city: string | null;
  pincode: string | null;
  notes: string | null;
  created_at: string;
};

type CustomerBooking = {
  id: string;
  created_at: string;
  service_category: string | null;
  status: string;
  amount: number | null;
  final_amount_paise: number | null;
};

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  CONFIRMED: "bg-blue-100 text-blue-800",
  DISPATCHED: "bg-indigo-100 text-indigo-800",
  IN_PROGRESS: "bg-purple-100 text-purple-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-slate-200 text-slate-700",
  PENDING_COLLECTION: "bg-amber-100 text-amber-800",
  COLLECTED: "bg-blue-100 text-blue-800",
  AT_LAB: "bg-purple-100 text-purple-800",
  REPORT_READY: "bg-cyan-100 text-cyan-800",
  AWAITING_PAYMENT: "bg-rose-100 text-rose-800",
  REPORT_DELIVERED: "bg-emerald-100 text-emerald-800",
};

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createOpsRSCClient();

  const [customerResult, bookingsResult] = await Promise.all([
    supabase
      .from("customers")
      .select(
        "id, customer_code, full_name, phone, email, date_of_birth, gender, address_line, area, city, pincode, notes, created_at",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("bookings")
      .select("id, created_at, service_category, status, amount, final_amount_paise")
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const customer = customerResult.data as Customer | null;
  if (!customer) notFound();

  const bookings = (bookingsResult.data as CustomerBooking[] | null) ?? [];

  return (
    <div className="px-8 py-8 max-w-5xl">
      <Link
        href="/ops/patients"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to patients
      </Link>

      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="font-mono text-xs text-slate-500 mb-1">
            {customer.customer_code}
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{customer.full_name}</h1>
          <div className="text-sm text-slate-600 mt-1">
            Created {new Date(customer.created_at).toLocaleString("en-IN")}
          </div>
        </div>
      </div>

      <ProfileCard customer={customer} />

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-baseline justify-between">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
            Bookings
          </div>
          <div className="text-xs text-slate-500">
            {bookings.length} record{bookings.length === 1 ? "" : "s"}
          </div>
        </div>
        {bookings.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-slate-500">
            No bookings linked to this patient yet.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left">
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Booking
                </th>
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Date
                </th>
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Service
                </th>
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Status
                </th>
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500 text-right">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bookings.map((b) => {
                const rupees =
                  b.final_amount_paise != null
                    ? b.final_amount_paise / 100
                    : b.amount;
                return (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link
                        href={`/ops/bookings/${b.id}`}
                        className="font-mono text-xs text-slate-900 hover:text-primary underline"
                      >
                        #{b.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {new Date(b.created_at).toLocaleString("en-IN")}
                    </td>
                    <td className="px-5 py-3 text-slate-700">
                      {b.service_category ?? "—"}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={
                          "inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full " +
                          (STATUS_STYLE[b.status] ?? "bg-slate-100 text-slate-700")
                        }
                      >
                        {b.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-slate-900">
                      {rupees != null ? `₹${rupees.toLocaleString("en-IN")}` : "—"}
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
