"use client";

import { useCallback } from "react";
import { useBookingStore } from "@/store/bookingStore";
import { getServicePrice } from "@/constants/pricing";
import { useRazorpayCheckout } from "@/hooks/useRazorpayCheckout";

const ERROR_MESSAGES = {
  NETWORK:
    "Unable to connect. Please check your internet and try again, or call us at +91-9711977782.",
  SERVER:
    "Our servers are busy. Please try again in a moment, or call us directly at +91-9711977782.",
  VALIDATION: "Please check your details and try again.",
  PAYMENT_DISMISSED:
    "Payment cancelled. Your booking has not been confirmed. Please try again.",
  PAYMENT_FAILED:
    "Payment failed. No amount has been charged. Please try again or call us at +91-9711977782.",
  UNKNOWN:
    "Something went wrong. Please call us at +91-9711977782 to complete your booking.",
};

interface SubmitResult {
  success: boolean;
  error?: string;
  id?: string;
  /** When true, this was a free lab-collection booking (no Razorpay at booking). */
  isLabBooking?: boolean;
}

export function useBookingSubmit() {
  const {
    name,
    phone,
    location,
    gpsLocation,
    serviceCategory,
    selectedTests,
    appliedCoupon,
    setSubmitting,
    setConfirmedBooking,
  } = useBookingStore();

  const { openCheckout } = useRazorpayCheckout();

  const submitBooking = useCallback(async (): Promise<SubmitResult> => {
    // === 1. Client-side validation (shared between flows) ===
    if (!name.trim()) {
      return { success: false, error: "Please enter patient name" };
    }
    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length !== 12 || !phoneDigits.startsWith("91")) {
      return { success: false, error: "Please enter a valid 10-digit phone number" };
    }
    if (!location.trim()) {
      return { success: false, error: "Please enter the complete address" };
    }
    if (location.trim().length < 10) {
      return {
        success: false,
        error: "Please enter a more detailed address for accurate service",
      };
    }
    if (!serviceCategory) {
      return { success: false, error: "Please select a service type" };
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return { success: false, error: ERROR_MESSAGES.NETWORK };
    }

    // Lab bookings must have at least one test selected
    if (serviceCategory === "diagnostics" && selectedTests.length === 0) {
      return {
        success: false,
        error:
          "Please select at least one lab test from the search above before booking.",
      };
    }

    setSubmitting(true);

    // === LAB BOOKING FLOW — free collection, pay-after-report ===
    // Goes through /api/lab/create-booking so the server can enforce the
    // OTP verification cookie before inserting. Previously this was a
    // client-side supabase.insert, which couldn't read the HttpOnly cookie.
    if (serviceCategory === "diagnostics") {
      try {
        const res = await fetch("/api/lab/create-booking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            patient_name: name.trim(),
            phone: phone.trim(),
            manual_address: location.trim(),
            gps_location: gpsLocation
              ? {
                  lat: gpsLocation.lat,
                  lng: gpsLocation.lng,
                  accuracy: gpsLocation.accuracy,
                }
              : null,
            selected_tests: selectedTests,
            applied_coupon: appliedCoupon
              ? {
                  code: appliedCoupon.code,
                  discount_percent: appliedCoupon.discount_percent,
                  discount_inr: appliedCoupon.discount_inr,
                }
              : null,
          }),
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          console.error("[lab booking] create-booking failed:", res.status, err);
          return {
            success: false,
            error:
              err.error ||
              (res.status === 401
                ? "Please verify your phone before booking."
                : ERROR_MESSAGES.SERVER),
          };
        }

        const { bookingId } = (await res.json()) as { bookingId: string };

        setConfirmedBooking({
          id: bookingId,
          name: name.trim(),
          phone: phone.trim(),
          location: location.trim(),
          gpsLocation,
          serviceCategory,
          selectedTests,
          appliedCoupon,
          confirmedAt: Date.now(),
        });

        return { success: true, id: bookingId, isLabBooking: true };
      } catch (err) {
        console.error("[lab booking] error:", err);
        return { success: false, error: ERROR_MESSAGES.UNKNOWN };
      } finally {
        setSubmitting(false);
      }
    }

    // === STANDARD BOOKING FLOW — ₹249 partial-prepay via Razorpay ===
    try {
      const orderRes = await fetch("/api/razorpay/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ serviceCategory, payFull: false }),
      });

      if (!orderRes.ok) {
        const err = await orderRes.json().catch(() => ({}));
        console.error("[booking] create-order failed:", err);
        return { success: false, error: err.error || ERROR_MESSAGES.SERVER };
      }

      const { orderId, amount, keyId } = (await orderRes.json()) as {
        orderId: string;
        amount: number;
        keyId: string;
      };

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
            service_category: serviceCategory,
            patient_name: name.trim(),
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Checkout error";
        if (msg.includes("dismissed")) {
          return { success: false, error: ERROR_MESSAGES.PAYMENT_DISMISSED };
        }
        return { success: false, error: ERROR_MESSAGES.PAYMENT_FAILED };
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
            service_category: serviceCategory,
            manual_address: location.trim(),
            gps_location: gpsLocation
              ? {
                  lat: gpsLocation.lat,
                  lng: gpsLocation.lng,
                  accuracy: gpsLocation.accuracy,
                }
              : null,
            amount: getServicePrice(serviceCategory),
          },
        }),
      });

      if (!verifyRes.ok) {
        const err = await verifyRes.json().catch(() => ({}));
        console.error("[booking] verify failed:", err);
        return {
          success: false,
          error:
            err.error ||
            "Payment received but booking failed to save. Please call us at +91-9711977782.",
        };
      }

      const { bookingId } = (await verifyRes.json()) as {
        ok: true;
        bookingId: string;
      };

      setConfirmedBooking({
        id: bookingId,
        name: name.trim(),
        phone: phone.trim(),
        location: location.trim(),
        gpsLocation,
        serviceCategory,
        confirmedAt: Date.now(),
      });

      return { success: true, id: bookingId };
    } catch (err) {
      console.error("[booking] submission error:", err);
      if (err instanceof Error) {
        if (
          err.message.includes("NetworkError") ||
          err.message.includes("Failed to fetch")
        ) {
          return { success: false, error: ERROR_MESSAGES.NETWORK };
        }
      }
      return { success: false, error: ERROR_MESSAGES.UNKNOWN };
    } finally {
      setSubmitting(false);
    }
  }, [
    name,
    phone,
    location,
    gpsLocation,
    serviceCategory,
    selectedTests,
    appliedCoupon,
    setSubmitting,
    setConfirmedBooking,
    openCheckout,
  ]);

  return { submitBooking };
}
