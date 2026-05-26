"use client";

import { useState } from "react";
import Script from "next/script";
import { Loader2, Download, CheckCircle2 } from "lucide-react";
import { useRazorpayCheckout } from "@/hooks/useRazorpayCheckout";

interface Props {
  token: string;
  orderId: string;
  amountPaise: number;
  patientName: string;
  paid?: boolean;
}

/**
 * Client component embedded inside /reports/[token]/page.tsx.
 *
 * Renders either:
 *  - "Pay & view" CTA → opens Razorpay Checkout → verifies → reveals signed URL
 *  - "Download report" button (when already paid)
 */
export function ReportPaymentClient({
  token,
  orderId,
  amountPaise,
  patientName,
  paid = false,
}: Props) {
  const { openCheckout } = useRazorpayCheckout();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [hasPaid, setHasPaid] = useState(paid);

  async function fetchSignedUrl() {
    // If already paid (server-rendered as paid), call verify-test-payment with
    // empty signature path? We need a separate "fetch-signed-url" endpoint.
    // For now: ask the user to click "Pay & view" — the verify endpoint will
    // detect already-paid state and just return the signed URL again.
    setError(
      "Already paid. Please contact us if your report didn't appear: +91-97119 77782"
    );
  }

  async function handlePayAndView() {
    if (!orderId) {
      setError(
        "Payment link is no longer active. Please contact us to receive a fresh link: +91-97119 77782"
      );
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const payment = await openCheckout({
        orderId,
        amount: amountPaise,
        keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "",
        prefill: { name: patientName, contact: "" },
        notes: { flow: "lab_report_payment", token },
      });

      const verifyRes = await fetch("/api/razorpay/verify-test-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unlockToken: token, ...payment }),
      });
      if (!verifyRes.ok) {
        const err = await verifyRes.json().catch(() => ({}));
        throw new Error(err.error || "Verification failed");
      }
      const { signedReportUrl } = (await verifyRes.json()) as {
        ok: true;
        signedReportUrl: string | null;
      };
      setHasPaid(true);
      setSignedUrl(signedReportUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Payment error";
      if (msg.includes("dismissed")) {
        setError("Payment cancelled. Your report is still locked.");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  if (hasPaid) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-sm text-text-main">
            <div className="font-semibold">Payment received — thank you.</div>
            <div className="text-text-secondary">
              Your report is ready to download. The link below is valid for 10
              minutes; refresh this page if it expires.
            </div>
          </div>
        </div>
        {signedUrl ? (
          <a
            href={signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 w-full bg-primary hover:bg-primary-dark text-white font-semibold px-5 py-3.5 rounded-xl transition-colors"
          >
            <Download className="w-5 h-5" />
            Download report PDF
          </a>
        ) : (
          <button
            type="button"
            onClick={fetchSignedUrl}
            className="inline-flex items-center justify-center gap-2 w-full bg-primary hover:bg-primary-dark text-white font-semibold px-5 py-3.5 rounded-xl transition-colors"
          >
            <Download className="w-5 h-5" />
            Get my report
          </button>
        )}
        {error && (
          <div className="text-sm text-rose-600">{error}</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/*
       * Razorpay Checkout JS — scoped here (and in BookingModal)
       * rather than the root layout, so non-payment surfaces
       * (/doctor, /ops, marketing pages) don't pull ~7.9 MB of
       * Razorpay chunks they never use. Next's <Script> dedupes on
       * src, so loading from multiple components is safe.
       */}
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="lazyOnload"
      />
      <button
        type="button"
        onClick={handlePayAndView}
        disabled={busy || !orderId}
        className="inline-flex items-center justify-center gap-2 w-full bg-[color:var(--color-accent-coral)] hover:bg-[color:var(--color-accent-coral-dark)] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold px-5 py-3.5 rounded-xl transition-colors shadow-md"
      >
        {busy ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Opening payment…
          </>
        ) : (
          <>Pay ₹{(amountPaise / 100).toLocaleString("en-IN")} & view report</>
        )}
      </button>
      {error && (
        <div className="text-sm text-rose-600 px-1">{error}</div>
      )}
      <div className="text-xs text-text-secondary text-center">
        Powered by Razorpay · UPI / card / netbanking / wallets accepted
      </div>
    </div>
  );
}
