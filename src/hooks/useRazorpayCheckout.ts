"use client";

import { useCallback } from "react";
import type {
  RazorpayCheckoutOptions,
  RazorpayPaymentSuccess,
} from "@/types/razorpay";

interface OpenCheckoutArgs {
  orderId: string;
  amount: number;
  keyId: string;
  prefill: { name: string; contact: string; email?: string };
  notes?: Record<string, string>;
}

/**
 * useRazorpayCheckout — client-side hook that wraps window.Razorpay.
 * Razorpay Checkout JS is loaded via <Script> in src/app/layout.tsx.
 *
 * Resolves with the payment-success payload on success, rejects on dismiss
 * or any failure.
 */
export function useRazorpayCheckout() {
  const openCheckout = useCallback(
    (args: OpenCheckoutArgs): Promise<RazorpayPaymentSuccess> => {
      return new Promise((resolve, reject) => {
        if (typeof window === "undefined" || !window.Razorpay) {
          reject(
            new Error(
              "Razorpay Checkout is still loading. Please try again in a moment."
            )
          );
          return;
        }

        const options: RazorpayCheckoutOptions = {
          key: args.keyId,
          amount: args.amount,
          currency: "INR",
          name: "Sanocare",
          description: "Booking confirmation — ₹249 partial-prepay",
          image: "/logo.svg",
          order_id: args.orderId,
          prefill: args.prefill,
          notes: args.notes,
          theme: { color: "#2B81FF" },
          retry: { enabled: true, max_count: 1 },
          handler: (response) => resolve(response),
          modal: {
            ondismiss: () => reject(new Error("Checkout dismissed")),
            confirm_close: true,
          },
        };

        try {
          const rzp = new window.Razorpay(options);
          rzp.on("payment.failed", (...args: unknown[]) => {
            const errResp = args[0] as { error?: { description?: string } };
            reject(
              new Error(errResp?.error?.description || "Payment failed")
            );
          });
          rzp.open();
        } catch (err) {
          reject(err);
        }
      });
    },
    []
  );

  return { openCheckout };
}
