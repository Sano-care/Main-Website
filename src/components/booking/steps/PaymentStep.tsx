"use client";

// T85 PR4a — Step 3 (Proceed to Pay).
//
// Renders an order summary + a coral "Proceed to Pay ₹{half}" CTA.
// Half-amount is 50% of the starting price, ROUNDED UP to the nearest
// ₹1 per founder spec (UPI doesn't handle paisa). The server
// re-computes the amount from the slug at order-creation time — the
// label here is for display only.
//
// Payment flow:
//   1. POST /api/razorpay/create-order with `{ t85Slug }`. Server
//      returns orderId + amount + keyId.
//   2. Open Razorpay Checkout via useRazorpayCheckout.
//   3. POST /api/razorpay/verify with the payment fields + the full
//      booking payload (including `t85Slug`, schedule, address).
//   4. On 200 success, call onConfirmed(bookingCode) so the
//      orchestrator advances to ConfirmStep.
//
// Errors are surfaced inline. Network / payment-dismissed states are
// recoverable — the patient can retry without losing form state.

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, AlertCircle, CreditCard } from "lucide-react";
import { Button } from "@/components/ui";
import { useBookingStore } from "@/store/bookingStore";
import { useRazorpayCheckout } from "@/hooks/useRazorpayCheckout";
import {
  getServiceHalfRoundedUp,
  getServiceRemainingAfterHalf,
  formatPrice,
} from "@/constants/pricing";
import { t85ToPricingKey } from "@/lib/booking/serviceMapper";
import type { ServiceSlug } from "@/lib/services/catalog";

interface PaymentStepProps {
  serviceSlug: ServiceSlug;
  serviceName: string;
  onConfirmed: (info: { bookingId: string; bookingCode: string | null }) => void;
}

export function PaymentStep({
  serviceSlug,
  serviceName,
  onConfirmed,
}: PaymentStepProps) {
  const name = useBookingStore((s) => s.name);
  const phone = useBookingStore((s) => s.phone);
  const location = useBookingStore((s) => s.location);
  const gpsLocation = useBookingStore((s) => s.gpsLocation);
  const scheduledFor = useBookingStore((s) => s.scheduledFor);
  const setSubmitting = useBookingStore((s) => s.setSubmitting);
  const isSubmitting = useBookingStore((s) => s.isSubmitting);

  const { openCheckout } = useRazorpayCheckout();
  const [error, setError] = useState<string | null>(null);

  const pricingKey = t85ToPricingKey(serviceSlug);
  const halfRupees = getServiceHalfRoundedUp(pricingKey);
  const remainingRupees = getServiceRemainingAfterHalf(pricingKey);
  const fullRupees = halfRupees + remainingRupees;

  const scheduleLabel =
    scheduledFor.kind === "asap"
      ? "ASAP"
      : new Date(scheduledFor.iso).toLocaleString("en-IN", {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "numeric",
          minute: "2-digit",
        });

  async function handlePay() {
    setError(null);
    setSubmitting(true);
    try {
      const orderRes = await fetch("/api/razorpay/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ t85Slug: serviceSlug }),
      });
      if (!orderRes.ok) {
        const errJson = await orderRes.json().catch(() => ({}));
        setError(errJson.error || "Could not start payment. Please retry.");
        return;
      }
      const { orderId, amount, keyId } = (await orderRes.json()) as {
        orderId: string;
        amount: number;
        keyId: string;
      };

      const phoneDigits = phone.replace(/\D/g, "");
      let payment;
      try {
        payment = await openCheckout({
          orderId,
          amount,
          keyId,
          prefill: {
            name: name.trim(),
            contact: phoneDigits.slice(-10),
          },
          notes: {
            t85_slug: serviceSlug,
            patient_name: name.trim(),
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Checkout error";
        if (msg.includes("dismissed")) {
          setError(
            "Payment cancelled. Your booking has not been confirmed. Tap Pay to retry.",
          );
        } else {
          setError(
            "Payment failed. No amount has been charged. Please retry or call +91-9711977782.",
          );
        }
        return;
      }

      const verifyRes = await fetch("/api/razorpay/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...payment,
          booking: {
            patient_name: name.trim(),
            phone: phone.trim(),
            // service_category gets overridden by t85Slug server-side
            // post-M039 — we still pass it for back-compat in case the
            // server is running pre-M039.
            service_category: serviceSlug,
            t85Slug: serviceSlug,
            manual_address: location.trim(),
            gps_location: gpsLocation
              ? {
                  lat: gpsLocation.lat,
                  lng: gpsLocation.lng,
                  accuracy: gpsLocation.accuracy,
                }
              : null,
            amount: fullRupees,
            scheduledFor,
          },
        }),
      });
      if (!verifyRes.ok) {
        const errJson = await verifyRes.json().catch(() => ({}));
        setError(
          errJson.error ||
            "Payment received but booking failed to save. Please call +91-9711977782.",
        );
        return;
      }
      const { bookingId, bookingCode } = (await verifyRes.json()) as {
        bookingId: string;
        bookingCode: string | null;
      };
      onConfirmed({ bookingId, bookingCode });
    } catch (err) {
      console.error("[PaymentStep] error", err);
      setError("Network error. Please check your connection and retry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center gap-2 text-primary">
        <CreditCard className="h-5 w-5" />
        <span className="text-xs font-mono uppercase tracking-widest">
          Step 3 of 3
        </span>
      </div>
      <h2 className="mt-2 text-2xl font-bold text-text-main">
        Review and pay
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        Pay 50% now to confirm your visit. The balance is charged when your
        case closes.
      </p>

      {/* Order summary */}
      <div className="mt-5 rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
        <SummaryRow label="Service" value={serviceName} />
        <SummaryRow label="Schedule" value={scheduleLabel} />
        <SummaryRow
          label="Address"
          value={location || "—"}
          mono={false}
          truncate
        />
        <SummaryRow
          label="Total cost"
          value={formatPrice(fullRupees)}
          strong
        />
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button
        type="button"
        variant="primary"
        size="lg"
        className="mt-5 w-full bg-[color:var(--color-accent-coral)] hover:bg-[color:var(--color-accent-coral-dark)]"
        disabled={isSubmitting}
        onClick={handlePay}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Opening payment&hellip;
          </>
        ) : (
          <>
            Proceed to Pay {formatPrice(halfRupees)}
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </Button>
      <p className="mt-2 text-center text-[12px] text-text-secondary">
        Balance {formatPrice(remainingRupees)} after your case is closed
      </p>
    </motion.div>
  );
}

function SummaryRow({
  label,
  value,
  strong,
  truncate,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-3.5">
      <span className="text-[12px] uppercase tracking-wider text-text-secondary font-semibold shrink-0">
        {label}
      </span>
      <span
        className={`text-right text-sm ${
          strong ? "font-bold text-text-main" : "text-text-main"
        } ${truncate ? "line-clamp-2" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
