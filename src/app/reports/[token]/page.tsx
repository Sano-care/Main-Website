import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { isValidTokenFormat } from "@/lib/lab-tokens";
import { ReportPaymentClient } from "./ReportPaymentClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your Lab Report",
  robots: { index: false, follow: false }, // token-gated page; don't index
};

export const dynamic = "force-dynamic"; // never cache, always fresh state

interface BookingForReport {
  id: string;
  patient_name: string;
  selected_tests: Array<{
    code: string;
    name: string;
    price: number;
    tat?: string;
  }>;
  test_total_paise: number | null;
  applied_coupon_code: string | null;
  coupon_discount_percent: number | null;
  coupon_discount_paise: number | null;
  final_amount_paise: number | null;
  report_payment_status:
    | "NOT_DUE"
    | "LINK_SENT"
    | "CAPTURED"
    | "REFUNDED"
    | null;
  report_razorpay_order_id: string | null;
  report_uploaded_at: string | null;
  status: string;
}

async function fetchBookingByToken(
  token: string
): Promise<BookingForReport | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, patient_name, selected_tests, test_total_paise, applied_coupon_code, coupon_discount_percent, coupon_discount_paise, final_amount_paise, report_payment_status, report_razorpay_order_id, report_uploaded_at, status"
    )
    .eq("report_unlock_token", token)
    .single();

  if (error || !data) return null;
  return data as BookingForReport;
}

export default async function ReportTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!isValidTokenFormat(token)) notFound();

  const booking = await fetchBookingByToken(token);
  if (!booking) notFound();

  const testTotalRupees = booking.test_total_paise
    ? booking.test_total_paise / 100
    : 0;
  const discountRupees = booking.coupon_discount_paise
    ? booking.coupon_discount_paise / 100
    : 0;
  const finalRupees = booking.final_amount_paise
    ? booking.final_amount_paise / 100
    : testTotalRupees;
  const isPaid = booking.report_payment_status === "CAPTURED";

  return (
    <div className="min-h-screen bg-background-light">
      <div className="mx-auto max-w-xl px-6 py-12 lg:py-20">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-primary transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Sanocare
        </Link>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="border-b border-slate-100 px-6 py-5">
            <div className="font-mono text-[11px] tracking-widest uppercase text-primary mb-1">
              Sanocare lab report
            </div>
            <h1 className="text-2xl font-bold text-text-main">
              Hi {booking.patient_name.split(" ")[0]}, your report is ready.
            </h1>
            <p className="text-sm text-text-secondary mt-1">
              Booking #{booking.id.slice(0, 8)} · Lab partner: Pathcore
              Diagnostics
            </p>
          </div>

          {/* Tests list */}
          <div className="px-6 py-5 border-b border-slate-100">
            <div className="font-mono text-[10px] tracking-widest uppercase text-text-secondary mb-3">
              Tests in this report
            </div>
            <ul className="space-y-2">
              {booking.selected_tests.map((t) => (
                <li
                  key={t.code}
                  className="flex items-start justify-between gap-3 text-sm"
                >
                  <div>
                    <div className="text-text-main font-medium">{t.name}</div>
                    <div className="text-xs text-text-secondary font-mono">
                      {t.code}
                    </div>
                  </div>
                  <div className="text-text-main shrink-0">
                    ₹{t.price.toLocaleString("en-IN")}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-4 pt-4 border-t border-slate-100 space-y-1.5">
              <div className="flex items-center justify-between text-sm text-text-secondary">
                <span>Subtotal</span>
                <span>₹{testTotalRupees.toLocaleString("en-IN")}</span>
              </div>
              {booking.applied_coupon_code && discountRupees > 0 && (
                <div className="flex items-center justify-between text-sm font-medium text-[color:var(--color-accent-coral-dark)]">
                  <span>
                    {booking.applied_coupon_code}
                    {booking.coupon_discount_percent
                      ? ` · ${booking.coupon_discount_percent}% off`
                      : ""}
                  </span>
                  <span>− ₹{discountRupees.toLocaleString("en-IN")}</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-100">
                <span className="text-sm font-semibold text-text-main">
                  Total payable
                </span>
                <span className="text-xl font-bold text-text-main">
                  ₹{finalRupees.toLocaleString("en-IN")}
                </span>
              </div>
            </div>
          </div>

          {/* Payment / Download */}
          <div className="px-6 py-6">
            {!isPaid ? (
              <>
                <div className="flex items-start gap-3 mb-5 p-4 rounded-xl bg-[color:var(--color-accent-coral-50)] border border-[color:var(--color-accent-coral)]">
                  <Lock className="w-5 h-5 text-[color:var(--color-accent-coral-dark)] shrink-0 mt-0.5" />
                  <div className="text-sm text-text-main">
                    <div className="font-semibold mb-1">
                      Your report unlocks once payment is confirmed.
                    </div>
                    <div className="text-text-secondary">
                      Pay ₹{finalRupees.toLocaleString("en-IN")} via UPI, card,
                      netbanking, or wallets.{" "}
                      {booking.applied_coupon_code && discountRupees > 0 && (
                        <>
                          (₹{discountRupees.toLocaleString("en-IN")} saved with
                          coupon <strong>{booking.applied_coupon_code}</strong>.){" "}
                        </>
                      )}
                      Your report becomes downloadable immediately after.
                    </div>
                  </div>
                </div>
                <ReportPaymentClient
                  token={token}
                  orderId={booking.report_razorpay_order_id || ""}
                  amountPaise={booking.final_amount_paise || booking.test_total_paise || 0}
                  patientName={booking.patient_name}
                />
              </>
            ) : (
              <ReportPaymentClient
                token={token}
                orderId={booking.report_razorpay_order_id || ""}
                amountPaise={booking.final_amount_paise || booking.test_total_paise || 0}
                patientName={booking.patient_name}
                paid
              />
            )}
          </div>

          {/* Help footer */}
          <div className="bg-slate-50 px-6 py-4 text-xs text-text-secondary">
            Trouble paying or downloading? Call us at{" "}
            <a
              href="tel:+919711977782"
              className="text-primary underline"
            >
              +91-97119 77782
            </a>{" "}
            or email{" "}
            <a
              href="mailto:contact@sanocare.in"
              className="text-primary underline"
            >
              contact@sanocare.in
            </a>
            . This link is private — please don&apos;t forward it.
          </div>
        </div>

        <p className="mt-6 text-xs text-text-secondary text-center">
          Sanocare Tech Innovations Pvt. Ltd. · CIN U86904DL2025PTC446725 · DPDP
          2023 compliant
        </p>
      </div>
    </div>
  );
}
