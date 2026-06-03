import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { formatIST } from "@/lib/time/formatIST";
import { getCurrentOpsUser } from "../../../../_lib/getCurrentOpsUser";
import { RefundForm } from "./RefundForm";
import { ReconcileForm } from "./ReconcileForm";

export const metadata: Metadata = {
  title: "Ops · Payment detail",
  robots: { index: false, follow: false },
};

// Same cache treatment as the other /ops detail pages (M2.7 fix).
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type Payment = {
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

type Refund = {
  id: string;
  razorpay_refund_id: string;
  amount_paise: number;
  status: "pending" | "processed" | "failed";
  reason: string | null;
  created_at: string;
  created_by: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  CREATED: "bg-slate-100 text-slate-700",
  CAPTURED: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-rose-100 text-rose-800",
  REFUNDED: "bg-amber-100 text-amber-800",
  PARTIAL_REFUND: "bg-amber-100 text-amber-800",
  NOT_DUE: "bg-slate-100 text-slate-500",
  LINK_SENT: "bg-blue-100 text-blue-800",
};

const REFUND_STATUS_STYLE: Record<Refund["status"], string> = {
  pending: "bg-slate-100 text-slate-700",
  processed: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
};

const KIND_LABEL: Record<Payment["payment_kind"], string> = {
  booking_fee: "Booking fee",
  report_fee: "Report fee",
};

export default async function PaymentDetailPage({
  params,
}: {
  params: Promise<{ booking_code: string; payment_kind: string }>;
}) {
  const { booking_code, payment_kind } = await params;

  if (payment_kind !== "booking_fee" && payment_kind !== "report_fee") {
    notFound();
  }
  const code = booking_code.toUpperCase();

  const supabase = await createOpsRSCClient();
  const opsUser = await getCurrentOpsUser();
  const isAdmin = opsUser.role === "admin";

  // 1. Payment row from the view
  const { data: paymentData } = await supabase
    .from("payments_v")
    .select("*")
    .eq("booking_code", code)
    .eq("payment_kind", payment_kind)
    .maybeSingle();
  const payment = paymentData as Payment | null;
  if (!payment) notFound();

  // 2. Refunds for this booking + lane
  const { data: refundsData } = await supabase
    .from("refunds")
    .select(
      "id, razorpay_refund_id, amount_paise, status, reason, created_at, created_by",
    )
    .eq("booking_id", payment.booking_id)
    .eq("payment_kind", payment_kind)
    .order("created_at", { ascending: false });
  const refunds = (refundsData as Refund[] | null) ?? [];

  // 3. Refundable balance = captured − (sum of processed + pending refunds)
  // Failed refunds don't count against the balance (Razorpay didn't move
  // any money). pending counts so the admin can't double-spend a refund
  // that's still settling.
  const reservedPaise = refunds
    .filter((r) => r.status !== "failed")
    .reduce((s, r) => s + r.amount_paise, 0);
  const isCaptured =
    payment.status === "CAPTURED" ||
    payment.status === "REFUNDED" ||
    payment.status === "PARTIAL_REFUND";
  const refundablePaise = isCaptured
    ? Math.max(0, payment.amount_paise - reservedPaise)
    : 0;

  return (
    <div className="px-8 py-8 max-w-5xl">
      <Link
        href="/ops/payments"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to payments
      </Link>

      <div className="mb-6">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1">
          {KIND_LABEL[payment.payment_kind]}
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-slate-900 font-mono">
            ₹{(payment.amount_paise / 100).toLocaleString("en-IN")}
          </h1>
          {payment.status && (
            <span
              className={
                "inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full " +
                (STATUS_STYLE[payment.status] ?? "bg-slate-100 text-slate-700")
              }
            >
              {payment.status}
            </span>
          )}
        </div>
        <div className="text-sm text-slate-600 mt-2">
          Created {formatIST(payment.created_at)}
          {payment.captured_at && (
            <> · Captured {formatIST(payment.captured_at)}</>
          )}
        </div>
      </div>

      {/* ===== Identity strip ===== */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-3">
          Razorpay
        </div>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <Field label="Payment id" mono>
            {payment.razorpay_payment_id ?? "—"}
          </Field>
          <Field label="Order id" mono>
            {payment.razorpay_order_id ?? "—"}
          </Field>
          <Field label="Service">
            {payment.service_category ?? "—"}
          </Field>
          <Field label="Booking status">
            {payment.booking_status}
          </Field>
        </div>
      </div>

      {/* ===== Booking + customer ===== */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-3">
          Booking & customer
        </div>
        <div className="text-sm">
          <div>
            <span className="text-slate-500">Booking: </span>
            <Link
              href={`/ops/bookings/${payment.booking_id}`}
              className="font-mono text-slate-900 hover:text-primary underline"
            >
              {payment.booking_code}
            </Link>
          </div>
          {payment.customer_id ? (
            <div className="mt-2">
              <span className="text-slate-500">Customer: </span>
              <Link
                href={`/ops/patients/${payment.customer_id}`}
                className="text-slate-900 hover:text-primary underline"
              >
                {payment.customer_name}
              </Link>
              <span className="text-slate-500 ml-1.5 font-mono text-xs">
                ({payment.customer_code})
              </span>
            </div>
          ) : (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase tracking-wider text-amber-800 mb-2">
                Unreconciled
              </div>
              <p className="text-sm text-amber-900 mb-3">
                This payment isn&apos;t linked to a customer record yet. Link
                the booking to a customer below — the same SAN-C lookup the
                rest of /ops uses.
              </p>
              <ReconcileForm bookingId={payment.booking_id} />
            </div>
          )}
        </div>
      </div>

      {/* ===== Refundable balance + Issue refund (admin only) ===== */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6">
        <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
            Refundable
          </div>
          <div className="text-right">
            <div className="font-mono font-semibold text-slate-900">
              ₹{(refundablePaise / 100).toLocaleString("en-IN")}
            </div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
              of ₹{(payment.amount_paise / 100).toLocaleString("en-IN")} captured
            </div>
          </div>
        </div>

        {!isCaptured ? (
          <p className="text-sm text-slate-500">
            Payment isn&apos;t captured yet — nothing to refund.
          </p>
        ) : refundablePaise === 0 ? (
          <p className="text-sm text-slate-500">
            Fully refunded. {reservedPaise > 0 && `(₹${(reservedPaise / 100).toLocaleString("en-IN")} across ${refunds.length} refund${refunds.length === 1 ? "" : "s"}.)`}
          </p>
        ) : isAdmin ? (
          <RefundForm
            bookingId={payment.booking_id}
            paymentKind={payment.payment_kind}
            refundablePaise={refundablePaise}
            bookingCode={payment.booking_code}
          />
        ) : (
          <p className="text-sm text-slate-500">
            Refunds are restricted to ops admins. Ask an admin to issue this
            from the same page.
          </p>
        )}
      </div>

      {/* ===== Refunds history ===== */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-baseline justify-between">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
            Refunds
          </div>
          <div className="text-xs text-slate-500">
            {refunds.length} record{refunds.length === 1 ? "" : "s"}
          </div>
        </div>
        {refunds.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-slate-500">
            No refunds issued against this payment.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left">
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Razorpay refund id
                </th>
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500 text-right">
                  Amount
                </th>
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Status
                </th>
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Reason
                </th>
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  When
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {refunds.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-3 font-mono text-xs text-slate-700">
                    {r.razorpay_refund_id}
                  </td>
                  <td className="px-5 py-3 text-right font-medium text-slate-900">
                    ₹{(r.amount_paise / 100).toLocaleString("en-IN")}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={
                        "inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full " +
                        REFUND_STATUS_STYLE[r.status]
                      }
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-600 max-w-xs truncate">
                    {r.reason ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {formatIST(r.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
