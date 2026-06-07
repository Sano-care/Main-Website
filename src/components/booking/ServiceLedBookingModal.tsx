"use client";

// T85 PR4a — service-led booking modal/sheet.
//
// Orchestrates the 3-or-4-step booking flow for the 3 non-lab services
// (Home-Visit, Teleconsultation, Medic at Home). Lab Tests still hits
// T61's BookingModal via the PR2.5 stopgap; Navbar mounts BOTH modals
// and the dispatch is by `bookingStore.serviceSlug`.
//
// Step order:
//   1. IdentifyStep   — name only (phone already verified via BookingGate)
//   2. WhereWhenStep  — address + SchedulePicker
//   3. PaymentStep    — order summary + Razorpay
//   4. ConfirmStep    — Case ID + WhatsApp deep link + Done
//
// Auto-skip Step 1: if `bookingStore.name` already has a 2+ character
// value (returning patient who's already booked once), we start at
// Step 2. The brief's "skip if signed in" rule maps to this — being
// signed in here means having a name + verified phone in the store.
//
// Close behaviour:
//   - Backdrop tap / X / Done all close the modal AND call
//     bookingStore.resetForNewBooking() so the next coral CTA tap
//     starts a clean flow (no stale schedule / address from a prior
//     booking).
//   - Done additionally scrolls to top per founder Q4 (a).

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useBookingStore } from "@/store/bookingStore";
import { getServiceBySlug } from "@/lib/services/catalog";
import type { ServiceSlug } from "@/lib/services/catalog";

import { IdentifyStep } from "./steps/IdentifyStep";
import { WhereWhenStep } from "./steps/WhereWhenStep";
import { PaymentStep } from "./steps/PaymentStep";
import { ConfirmStep } from "./steps/ConfirmStep";

type Step = "identify" | "wherewhen" | "payment" | "confirm";

interface ServiceLedBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ServiceLedBookingModal({
  isOpen,
  onClose,
}: ServiceLedBookingModalProps) {
  const serviceSlug = useBookingStore((s) => s.serviceSlug);
  const storedName = useBookingStore((s) => s.name);
  const resetForNewBooking = useBookingStore((s) => s.resetForNewBooking);

  const [step, setStep] = useState<Step>(() =>
    storedName.trim().length >= 2 ? "wherewhen" : "identify",
  );
  const [confirmed, setConfirmed] = useState<{
    bookingId: string;
    bookingCode: string | null;
  } | null>(null);

  // Reset internal state every (re)open. The starting step depends on
  // whether the patient already has a name in store — returning
  // patient flow skips Step 1.
  useEffect(() => {
    if (!isOpen) return;
    setStep(storedName.trim().length >= 2 ? "wherewhen" : "identify");
    setConfirmed(null);
  }, [isOpen, storedName]);

  const service = useMemo(
    () => (serviceSlug ? getServiceBySlug(serviceSlug) : null),
    [serviceSlug],
  );

  // PR2.5 stopgap dispatch: Lab Tests still uses T61's BookingModal.
  // Navbar mounts both; isOpen for THIS modal is only true when the
  // active slug is non-lab. As a defensive guard we also short-circuit
  // here in case a future caller flips isOpen incorrectly.
  if (serviceSlug === "lab-tests") return null;

  function handleClose() {
    onClose();
    // Defer the reset by a tick so the exit animation isn't disrupted
    // by mid-flight state changes (otherwise the modal jumps to step 1
    // visibly during the fade-out).
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

  // Without a selected service we can't proceed — render nothing.
  // (This is also a defensive guard; useBookingFlow.requestBookingForService
  // always seeds the slug before opening.)
  if (!serviceSlug || !service) return null;

  return (
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
            className="relative w-full sm:max-w-md bg-white shadow-2xl rounded-t-3xl sm:rounded-2xl max-h-[92vh] overflow-y-auto"
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 30 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="service-led-booking-title"
          >
            {/* Header — service + slug eyebrow */}
            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-slate-100 px-5 py-3 flex items-center justify-between">
              <div>
                <p className="text-[10.5px] font-mono uppercase tracking-widest text-[color:var(--color-accent-coral-dark)]">
                  Booking
                </p>
                <h3
                  id="service-led-booking-title"
                  className="text-sm font-bold text-text-main leading-tight"
                >
                  {service.name}
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

            {/* Body */}
            <div className="px-5 py-5 sm:px-6 sm:py-6">
              {step === "identify" && (
                <IdentifyStep
                  onComplete={() => setStep("wherewhen")}
                />
              )}
              {step === "wherewhen" && (
                <WhereWhenStep
                  serviceSlug={serviceSlug as ServiceSlug}
                  onContinue={() => setStep("payment")}
                />
              )}
              {step === "payment" && (
                <PaymentStep
                  serviceSlug={serviceSlug as ServiceSlug}
                  serviceName={service.name}
                  onConfirmed={(info) => {
                    setConfirmed(info);
                    setStep("confirm");
                  }}
                />
              )}
              {step === "confirm" && confirmed && (
                <ConfirmStep
                  bookingId={confirmed.bookingId}
                  bookingCode={confirmed.bookingCode}
                  onDone={handleDone}
                />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
