import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { ArrowLeft, AlertCircle } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ops · Lab Orders",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface LabBookingRow {
  id: string;
  created_at: string;
  patient_name: string;
  phone: string;
  manual_address: string;
  status: string;
  selected_tests: Array<{ code: string; name: string; price: number }> | null;
  test_total_paise: number | null;
  report_payment_status: string | null;
  lab_partner_order_id: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  PENDING_COLLECTION: "bg-amber-100 text-amber-800",
  COLLECTED: "bg-blue-100 text-blue-800",
  AT_LAB: "bg-purple-100 text-purple-800",
  REPORT_READY: "bg-cyan-100 text-cyan-800",
  AWAITING_PAYMENT: "bg-rose-100 text-rose-800",
  REPORT_DELIVERED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-slate-200 text-slate-700",
};

const STATUS_ORDER = [
  "PENDING_COLLECTION",
  "COLLECTED",
  "AT_LAB",
  "REPORT_READY",
  "AWAITING_PAYMENT",
  "REPORT_DELIVERED",
];

async function fetchLabBookings(): Promise<LabBookingRow[] | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, created_at, patient_name, phone, manual_address, status, selected_tests, test_total_paise, report_payment_status, lab_partner_order_id"
    )
    .eq("service_category", "diagnostics")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[ops/lab] fetch failed:", error);
    return null;
  }
  return (data || []) as LabBookingRow[];
}

export default async function OpsLabPage() {
  const bookings = await fetchLabBookings();

  if (bookings === null) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-2xl px-6 py-16">
          <div className="bg-white border border-rose-200 rounded-2xl p-6">
            <div className="flex items-center gap-2 text-rose-700 mb-2">
              <AlertCircle className="w-5 h-5" />
              <span className="font-semibold">Could not load lab bookings</span>
            </div>
            <p className="text-sm text-text-secondary">
              Check that <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
              <code>SUPABASE_SERVICE_ROLE_KEY</code> are set in your Netlify env
              vars, and that migration 008_lab_diagnostics.sql has been run in
              your Supabase project.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const grouped: Record<string, LabBookingRow[]> = {};
  for (const status of STATUS_ORDER) grouped[status] = [];
  for (const b of bookings) {
    const k = grouped[b.status] ? b.status : "PENDING_COLLECTION";
    grouped[k].push(b);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div>
            <Link
              href="/ops/dashboard"
              className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-primary transition-colors mb-3"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to ops dashboard
            </Link>
            <h1 className="text-3xl font-bold text-text-main tracking-tight">
              Lab Orders · Pathcore
            </h1>
            <p className="text-sm text-text-secondary mt-1">
              {bookings.length} diagnostic booking
              {bookings.length === 1 ? "" : "s"} · most recent first
            </p>
          </div>
          <div className="font-mono text-xs text-text-secondary">
            Partner workflow: WhatsApp / phone / email
          </div>
        </div>

        {/* Quick counts by status */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
          {STATUS_ORDER.map((status) => (
            <div
              key={status}
              className="bg-white border border-slate-200 rounded-xl p-4"
            >
              <div className="text-2xl font-bold text-text-main">
                {grouped[status].length}
              </div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary mt-1">
                {status.replace(/_/g, " ")}
              </div>
            </div>
          ))}
        </div>

        {/* Bookings list */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 font-mono text-[11px] tracking-wider uppercase text-text-secondary">
            All lab bookings
          </div>
          {bookings.length === 0 ? (
            <div className="p-8 text-center text-text-secondary">
              No lab bookings yet. They&apos;ll show up here as patients book
              tests from <Link href="/lab-tests" className="text-primary underline">/lab-tests</Link>.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {bookings.map((b) => {
                const testCount = b.selected_tests?.length ?? 0;
                const totalRupees = b.test_total_paise
                  ? b.test_total_paise / 100
                  : 0;
                return (
                  <li key={b.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-semibold text-text-main">
                            {b.patient_name}
                          </span>
                          <span className="font-mono text-xs text-text-secondary">
                            #{b.id.slice(0, 8)}
                          </span>
                          <span
                            className={
                              "text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full " +
                              (STATUS_BADGE[b.status] ||
                                "bg-slate-100 text-slate-700")
                            }
                          >
                            {b.status.replace(/_/g, " ")}
                          </span>
                          {b.report_payment_status && (
                            <span className="text-[10px] font-mono uppercase tracking-wider text-text-secondary">
                              · pay: {b.report_payment_status}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-text-secondary">
                          <a
                            href={`tel:${b.phone.replace(/\s/g, "")}`}
                            className="text-primary underline"
                          >
                            {b.phone}
                          </a>{" "}
                          · {b.manual_address.slice(0, 70)}
                          {b.manual_address.length > 70 ? "…" : ""}
                        </div>
                        <div className="text-xs text-text-secondary mt-1">
                          {testCount} test{testCount === 1 ? "" : "s"} ·{" "}
                          {b.selected_tests
                            ?.slice(0, 3)
                            .map((t) => t.code)
                            .join(", ")}
                          {testCount > 3 && ` +${testCount - 3} more`}
                          {b.lab_partner_order_id && (
                            <>
                              {" · Pathcore #"}
                              <span className="font-mono">
                                {b.lab_partner_order_id}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-lg font-bold text-text-main">
                          ₹{totalRupees.toLocaleString("en-IN")}
                        </div>
                        <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary mt-1">
                          Test total
                        </div>
                        <div className="text-xs text-text-secondary mt-2">
                          {new Date(b.created_at).toLocaleString("en-IN")}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mt-8 bg-white border border-slate-200 rounded-2xl p-5 text-sm">
          <div className="font-semibold text-text-main mb-2">
            Workflow checklist for each lab order
          </div>
          <ol className="list-decimal ml-5 space-y-1 text-text-secondary">
            <li>
              Booking arrives here as <strong>PENDING_COLLECTION</strong>. WhatsApp
              the patient to confirm a collection time.
            </li>
            <li>
              Dispatch a phlebo. Once sample is collected, manually advance
              status to <strong>COLLECTED</strong> in Supabase (Studio → bookings
              row).
            </li>
            <li>
              Send the sample to Pathcore via your usual WhatsApp/phone channel.
              When Pathcore acknowledges, mark <strong>AT_LAB</strong> and record
              Pathcore&apos;s order id in <code>lab_partner_order_id</code>.
            </li>
            <li>
              When Pathcore returns the report PDF, upload to Supabase Storage{" "}
              (bucket <code>lab-reports</code>), copy the storage path.
            </li>
            <li>
              POST to <code>/api/lab/send-report-payment-link</code> with the
              booking id + storage path (use Postman / curl with the{" "}
              <code>x-ops-token</code> header). This generates a Razorpay order +
              magic-link.
            </li>
            <li>
              WhatsApp the patient the link they receive: it&apos;ll be{" "}
              <code>https://sanocare.in/reports/&lt;token&gt;</code>.
            </li>
            <li>
              Patient pays via Razorpay → report unlocks automatically. Booking
              moves to <strong>REPORT_DELIVERED</strong>.
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
