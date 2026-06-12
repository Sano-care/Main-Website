"use client";

import { useBookingStore } from "@/store/bookingStore";
import { BookingGate } from "@/components/booking/BookingGate";
import { LabBasketWindow } from "@/components/booking/LabBasketWindow";
import { ServiceLedBookingModal } from "@/components/booking/ServiceLedBookingModal";
import { BookingModal } from "@/components/BookingModal";

/**
 * Shared mount-site for the four bookingStore-driven overlays:
 *   - BookingModal              (legacy T61 — only opens when serviceSlug === null)
 *   - ServiceLedBookingModal    (T85 PR4a — opens when isModalOpen && serviceSlug !== null)
 *   - LabBasketWindow           (T85 PR4b — opens when isLabBasketOpen)
 *   - BookingGate               (OTP gate — opens when isGateOpen)
 *
 * Extracted from Navbar.tsx as part of T90 Slice 2 Step 11 (post-UAT).
 *
 * Why this exists:
 *   The booking dispatch (useBookingFlow + bookingStore) is decoupled
 *   from the booking modals via a zustand store — convenient for
 *   triggers but means the dispatch-side AND receive-side must both
 *   live in the same React tree. Pre-extraction, the modals were
 *   mounted inline by Navbar.tsx; any surface that didn't render
 *   <Navbar /> (notably /pulse routes, which use PulseChrome instead
 *   of the marketing navbar) could fire booking dispatches into the
 *   void — store flips, no UI appears.
 *
 *   Now both call sites — Navbar (marketing) + PulseChrome (Pulse) —
 *   render <BookingFlowMounts /> once. Single source of truth for the
 *   mount logic. Future modals added here automatically pick up both
 *   trees.
 *
 * Dispatch shape (preserved verbatim from Navbar.tsx pre-extraction):
 *   - isLabBasketOpen → LabBasketWindow (PR4b service-led lab path)
 *   - isModalOpen && serviceSlug !== null → ServiceLedBookingModal (PR4a)
 *   - isModalOpen && serviceSlug === null → BookingModal (T61 fallback,
 *       Navbar's "Book a Visit" pill — Pulse tiles always set a slug
 *       so they never hit this branch)
 *   - isGateOpen → BookingGate (OTP gate, independent of modal flags)
 *
 *   `isLabBasketOpen` and `isModalOpen` are independent flags by design —
 *   useBookingFlow.requestBookingForLab() calls openLabBasket() (not
 *   openModal()) so isModalOpen stays false on the lab path.
 *
 * Class-of-bug guardrail for future Pulse work: any new zustand-decoupled
 * surface that opens its own modal must follow the same dispatch+mount-in-
 * same-tree rule. Add the modal to this file (and its open-flag selector)
 * rather than mounting it inline elsewhere.
 */
export default function BookingFlowMounts() {
  const isModalOpen = useBookingStore((s) => s.isModalOpen);
  const closeModal = useBookingStore((s) => s.closeModal);
  const isGateOpen = useBookingStore((s) => s.isGateOpen);
  const closeGate = useBookingStore((s) => s.closeGate);
  const isLabBasketOpen = useBookingStore((s) => s.isLabBasketOpen);
  const closeLabBasket = useBookingStore((s) => s.closeLabBasket);
  const serviceSlug = useBookingStore((s) => s.serviceSlug);

  const useT85Modal = isModalOpen && serviceSlug !== null;
  const useT61Modal = isModalOpen && !useT85Modal;

  return (
    <>
      <BookingModal isOpen={useT61Modal} onClose={closeModal} />
      <ServiceLedBookingModal isOpen={useT85Modal} onClose={closeModal} />
      <LabBasketWindow isOpen={isLabBasketOpen} onClose={closeLabBasket} />
      <BookingGate
        isOpen={isGateOpen}
        onClose={closeGate}
        onVerified={() => closeGate()}
      />
    </>
  );
}
