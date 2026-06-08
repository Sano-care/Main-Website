"use client";

// T85 PR4b — Lab Tests Basket window.
//
// Full-screen modal/sheet on mobile, capped centered modal on desktop.
// Single scrollable view with header + footer fixed; the basket body
// scrolls. Same layout pattern as ServiceLedBookingModal.
//
// Local state (basket lines + applied coupon) lives here — nothing
// else reads it, so we don't pollute bookingStore. On successful pay,
// the booking is POSTed to /api/lab/create-booking-prepaid which
// inserts the row + fires `aarogya_lead_alert`; we then re-use
// ConfirmStep (the same one PR4a uses) for the final screen.
//
// Address + schedule both come from bookingStore (`location`,
// `gpsLocation`, `scheduledFor`) so they survive component unmounts
// during the gate→basket handoff.

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowRight, Crosshair, Loader2, AlertCircle } from "lucide-react";
import Script from "next/script";
import { useBookingStore } from "@/store/bookingStore";
import { useScrollLock } from "@/hooks/useScrollLock";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useRazorpayCheckout } from "@/hooks/useRazorpayCheckout";
import { SchedulePicker, slotIso } from "@/components/booking/SchedulePicker";
import { ConfirmStep } from "@/components/booking/steps/ConfirmStep";
import {
  LAB_COMMON_TESTS,
  LAB_COLLECTION_FEE_INR,
  type LabCatalogItem,
} from "@/lib/services/labCatalog";

import { SearchBar } from "./lab/SearchBar";
import { CommonTestsGrid } from "./lab/CommonTestsGrid";
import { BasketSection } from "./lab/BasketSection";
import { CouponSection } from "./lab/CouponSection";
import { SubtotalBlock } from "./lab/SubtotalBlock";
import { PayCTA } from "./lab/PayCTA";
import type { BasketLine, AppliedLabCoupon } from "./lab/types";
import type { SearchResult } from "./lab/SearchBar";

interface LabBasketWindowProps {
  isOpen: boolean;
  onClose: () => void;
}

// Pre-compute the "Fasting recommended" annotations for 7-9 AM slots
// across the next few days. The SchedulePicker matches these by ISO
// string so the note renders on the right slots.
function fastingAnnotations(): Array<{ slotIso: string; note: string }> {
  const out: Array<{ slotIso: string; note: string }> = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    d.setHours(0, 0, 0, 0);
    // SchedulePicker only renders 9 AM onwards (SLOT_START_HOURS starts at 9),
    // so the 7-8 AM "fasting" window the brief mentioned falls outside the
    // visible range. The closest morning slot we CAN annotate is 9 AM —
    // we annotate the 9 AM window since fasting tests typically clear by
    // 10 AM collection.
    out.push({
      slotIso: slotIso(d, 9),
      note: "Fasting recommended",
    });
  }
  return out;
}

export function LabBasketWindow({ isOpen, onClose }: LabBasketWindowProps) {
  const name = useBookingStore((s) => s.name);
  const phone = useBookingStore((s) => s.phone);
  const location = useBookingStore((s) => s.location);
  const setDetails = useBookingStore((s) => s.setDetails);
  const gpsLocation = useBookingStore((s) => s.gpsLocation);
  const scheduledFor = useBookingStore((s) => s.scheduledFor);
  const setScheduledFor = useBookingStore((s) => s.setScheduledFor);
  const resetForNewBooking = useBookingStore((s) => s.resetForNewBooking);
  const isLocating = useBookingStore((s) => s.isLocating);
  const locationError = useBookingStore((s) => s.locationError);

  const { detectLocation } = useGeolocation();
  const { openCheckout } = useRazorpayCheckout();

  // Local basket state — see types.ts for the BasketLine shape.
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [applied, setApplied] = useState<AppliedLabCoupon | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{
    bookingId: string;
    bookingCode: string | null;
  } | null>(null);

  // Reset state on every (re)open so the basket doesn't carry over
  // between two booking attempts in the same session.
  useEffect(() => {
    if (!isOpen) return;
    setBasket([]);
    setApplied(null);
    setSubmitError(null);
    setConfirmed(null);
  }, [isOpen]);

  useScrollLock(isOpen);

  const annotations = useMemo(() => fastingAnnotations(), []);

  function handleAdd(item: LabCatalogItem) {
    setApplied(null); // coupon must re-apply when basket changes
    setBasket((prev) => {
      if (prev.some((l) => l.id === item.id)) return prev;
      const line: BasketLine = {
        id: item.id,
        name: item.name,
        code: item.kind === "test" ? item.pathcoreCode : item.id,
        priceInr: item.price,
        mrpInr: item.mrp,
        qty: 1,
        isPackage: item.kind === "package",
      };
      return [...prev, line];
    });
  }
  function handleAddFromSearch(r: SearchResult) {
    setApplied(null);
    setBasket((prev) => {
      if (prev.some((l) => l.id === r.code)) {
        // Already in basket — bump qty by 1 (search adds count up).
        return prev.map((l) =>
          l.id === r.code ? { ...l, qty: l.qty + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          id: r.code,
          name: r.name,
          code: r.code,
          priceInr: r.priceInr,
          // Search results don't carry MRP — show priceInr as the
          // strikethrough value so the row still renders cleanly.
          // Founder edits the brief if MRP is wanted on search-added
          // tests (would need a column on lab_tests).
          mrpInr: r.priceInr,
          qty: 1,
          isPackage: false,
        },
      ];
    });
  }
  function handleIncrement(id: string) {
    setApplied(null);
    setBasket((prev) =>
      prev.map((l) => (l.id === id && !l.isPackage ? { ...l, qty: l.qty + 1 } : l)),
    );
  }
  function handleDecrement(id: string) {
    setApplied(null);
    setBasket((prev) =>
      prev.map((l) =>
        l.id === id && !l.isPackage && l.qty > 1 ? { ...l, qty: l.qty - 1 } : l,
      ),
    );
  }
  function handleRemove(id: string) {
    setApplied(null);
    setBasket((prev) => prev.filter((l) => l.id !== id));
  }
  function handleClearAll() {
    setApplied(null);
    setBasket([]);
  }

  const subtotalInr = basket.reduce((s, l) => s + l.priceInr * l.qty, 0);
  const discountInr = applied?.discountInr ?? 0;
  const grandTotalInr = Math.max(
    0,
    Math.ceil(subtotalInr - discountInr + LAB_COLLECTION_FEE_INR),
  );

  const trimmedAddr = location.trim();
  const canPay =
    !submitting && basket.length > 0 && trimmedAddr.length >= 10;

  async function handlePay() {
    if (!canPay) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      // 1. Create Razorpay order with server-computed amount.
      const orderRes = await fetch("/api/razorpay/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          kind: "lab-prepaid",
          subtotalInr,
          couponCode: applied?.code,
        }),
      });
      if (!orderRes.ok) {
        const err = (await orderRes.json().catch(() => ({}))) as { error?: string };
        setSubmitError(err.error || "Could not start payment. Please retry.");
        return;
      }
      const { orderId, amount, keyId } = (await orderRes.json()) as {
        orderId: string;
        amount: number;
        keyId: string;
      };

      // 2. Razorpay Checkout.
      const phoneDigits = phone.replace(/\D/g, "");
      let payment;
      try {
        payment = await openCheckout({
          orderId,
          amount,
          keyId,
          prefill: {
            name: name.trim() || "Patient",
            contact: phoneDigits.slice(-10),
          },
          notes: {
            t85_slug: "lab-tests",
            patient_name: name.trim() || "Patient",
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Checkout error";
        setSubmitError(
          msg.includes("dismissed")
            ? "Payment cancelled. Your booking has not been confirmed."
            : "Payment failed. No amount has been charged.",
        );
        return;
      }

      // 3. Persist booking + fire ops alert.
      const verifyRes = await fetch("/api/lab/create-booking-prepaid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...payment,
          booking: {
            patient_name: name.trim() || "Patient",
            phone: phone.trim(),
            manual_address: location.trim(),
            gps_location: gpsLocation
              ? {
                  lat: gpsLocation.lat,
                  lng: gpsLocation.lng,
                  accuracy: gpsLocation.accuracy,
                }
              : null,
            selected_tests: basket.map((l) => ({
              code: l.code,
              name: l.name,
              priceInr: l.priceInr,
              mrpInr: l.mrpInr,
              qty: l.qty,
            })),
            subtotalInr,
            couponCode: applied?.code ?? null,
            scheduledFor,
          },
        }),
      });
      if (!verifyRes.ok) {
        const err = (await verifyRes.json().catch(() => ({}))) as { error?: string };
        setSubmitError(
          err.error ||
            "Payment received but booking failed to save. Please call +91-9711977782.",
        );
        return;
      }
      const { bookingId, bookingCode } = (await verifyRes.json()) as {
        bookingId: string;
        bookingCode: string | null;
      };
      setConfirmed({ bookingId, bookingCode });
    } catch (err) {
      console.error("[LabBasketWindow] pay error", err);
      setSubmitError("Network error. Please check your connection and retry.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    onClose();
    setTimeout(() => {
      resetForNewBooking();
    }, 200);
  }
  function handleDone() {
    handleClose();
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function handleDetect() {
    try {
      await detectLocation();
    } catch {
      // useGeolocation pushes the message into bookingStore.locationError.
    }
  }

  return (
    <>
      {/* Razorpay checkout script — same lazy-load pattern as
          BookingModal so Razorpay v2 chunks aren't pulled by surfaces
          that never open this window. */}
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="lazyOnload"
      />
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={handleClose}
              aria-hidden="true"
            />

            <motion.div
              className="relative w-full sm:max-w-md bg-white shadow-2xl rounded-t-3xl sm:rounded-2xl flex flex-col max-h-[92vh]"
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 280, damping: 30 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="lab-basket-title"
            >
              {/* Header */}
              <div className="flex-shrink-0 sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-slate-100 px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-[10.5px] font-mono uppercase tracking-widest text-[color:var(--color-accent-coral-dark)]">
                    Booking
                  </p>
                  <h3
                    id="lab-basket-title"
                    className="text-sm font-bold text-text-main leading-tight"
                  >
                    Lab Tests at Home
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  aria-label="Close"
                  className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-slate-100 hover:text-text-main"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Scroller body */}
              <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 px-5 py-5 sm:px-6 sm:py-6 space-y-5">
                {confirmed ? (
                  <ConfirmStep
                    bookingId={confirmed.bookingId}
                    bookingCode={confirmed.bookingCode}
                    onDone={handleDone}
                  />
                ) : (
                  <>
                    {/* Address — required for the phlebotomist; uses
                        the same useGeolocation-backed bookingStore
                        fields as the non-lab WhereWhenStep. */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary">
                          Address
                        </label>
                        <button
                          type="button"
                          onClick={handleDetect}
                          disabled={isLocating}
                          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary hover:underline disabled:opacity-60"
                        >
                          {isLocating ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Detecting&hellip;
                            </>
                          ) : (
                            <>
                              <Crosshair className="h-3.5 w-3.5" />
                              Use my location
                            </>
                          )}
                        </button>
                      </div>
                      <textarea
                        rows={2}
                        autoComplete="street-address"
                        placeholder="Flat / House no., street, locality"
                        value={location}
                        onChange={(e) =>
                          setDetails({ location: e.target.value })
                        }
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all placeholder:text-slate-400 resize-none"
                      />
                      {locationError && (
                        <div className="flex items-start gap-1.5 text-[11.5px] text-amber-800">
                          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>{locationError}</span>
                        </div>
                      )}
                    </div>

                    {/* Search bar */}
                    <div>
                      <SearchBar onPick={handleAddFromSearch} />
                    </div>

                    {/* Common Tests grid */}
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-2">
                        Common tests
                      </h3>
                      <CommonTestsGrid
                        basket={basket}
                        onAdd={handleAdd}
                        onRemove={handleRemove}
                      />
                    </div>

                    {/* Basket + Coupons + Subtotal — only after first
                        item is added. */}
                    {basket.length > 0 && (
                      <>
                        <BasketSection
                          basket={basket}
                          onIncrement={handleIncrement}
                          onDecrement={handleDecrement}
                          onRemove={handleRemove}
                          onClearAll={handleClearAll}
                        />

                        <CouponSection
                          subtotalInr={subtotalInr}
                          applied={applied}
                          onApply={setApplied}
                          onRemove={() => setApplied(null)}
                        />

                        <SubtotalBlock
                          subtotalInr={subtotalInr}
                          applied={applied}
                        />

                        {/* Schedule */}
                        <div>
                          <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary mb-1.5">
                            When
                          </label>
                          <SchedulePicker
                            value={scheduledFor}
                            onChange={setScheduledFor}
                            asapLabel="Phlebotomist arrives in ~90 min"
                            slotAnnotations={annotations}
                          />
                        </div>
                      </>
                    )}

                    {submitError && (
                      <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{submitError}</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Sticky-bottom Pay CTA — only when basket has items
                  and we're not on the confirmation screen. */}
              {!confirmed && basket.length > 0 && (
                <PayCTA
                  grandTotalInr={grandTotalInr}
                  disabled={!canPay}
                  submitting={submitting}
                  onClick={handlePay}
                />
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// Suppress unused-import warning for tree-shaking — LAB_COMMON_TESTS
// is consumed inside CommonTestsGrid via re-import; this file only
// imports it for the side-effect of pulling in the build-time
// validator's reference graph.
void LAB_COMMON_TESTS;
// Suppress unused-import warning for ArrowRight (kept for parity with
// PR4a's lockup; may be wired in a future "Tap to add" CTA variant).
void ArrowRight;
