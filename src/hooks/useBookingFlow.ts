"use client";

import { useCallback, useEffect, useState } from "react";

import { useBookingStore } from "@/store/bookingStore";
import type { ServiceSlug } from "@/lib/services/catalog";

// Shared "Book a Visit" trigger for the T61 booking-density sweep.
//
// The homepage now starts a booking from many places — the hero, the sticky
// bottom bar, the mobile menu, and a BookingCTAStrip after every major section.
// They all want the SAME gate→modal flow that the Navbar button has always run:
//
//   verified?  → open the BookingModal straight away.
//   not yet?   → open the BookingGate (OTP); once the store reflects a verified
//                phone, resume by opening the modal.
//
// This hook extracts exactly that logic (previously inline in Navbar) so any
// client component can call `requestBooking()` without re-implementing the
// gate-then-resume dance, and WITHOUT touching the modal flow itself (it's the
// same store actions, just callable from anywhere). The BookingModal +
// BookingGate are still mounted once, in Navbar.
//
// Each hook instance keeps its own `pending` flag, so only the surface the
// patient actually tapped resumes into the modal after verification. Every
// caller in the homepage is persistently mounted (the mobile menu delegates its
// CTA to Navbar's handler), so a pending resume is never lost to an unmount.

export function useBookingFlow() {
  const openModal = useBookingStore((s) => s.openModal);
  const openGate = useBookingStore((s) => s.openGate);
  const openLabBasket = useBookingStore((s) => s.openLabBasket);
  const setServiceSlug = useBookingStore((s) => s.setServiceSlug);
  const serviceSlug = useBookingStore((s) => s.serviceSlug);
  const phoneVerifiedUntil = useBookingStore((s) => s.phoneVerifiedUntil);

  const [pending, setPending] = useState(false);

  // `Date.now()` is read inside the effect / callback only (never during
  // render) so the hook stays render-pure. `phoneVerifiedUntil` changing is
  // what re-runs the effect after a successful OTP, resuming into the
  // correct surface — modal for non-lab, lab basket for `lab-tests`.
  useEffect(() => {
    const verified =
      phoneVerifiedUntil !== null && phoneVerifiedUntil > Date.now();
    if (pending && verified) {
      setPending(false);
      if (serviceSlug === "lab-tests") {
        openLabBasket();
      } else {
        openModal();
      }
    }
  }, [pending, phoneVerifiedUntil, serviceSlug, openModal, openLabBasket]);

  const requestBooking = useCallback(() => {
    const verified =
      phoneVerifiedUntil !== null && phoneVerifiedUntil > Date.now();
    if (verified) {
      openModal();
    } else {
      setPending(true);
      openGate();
    }
  }, [phoneVerifiedUntil, openModal, openGate]);

  /**
   * T85 PR4a — service-led variant. Seeds bookingStore.serviceSlug
   * before opening the gate or modal so the new ServiceLedBookingModal
   * knows which service the patient tapped on. Used by the 4 coral
   * CTAs in `ServiceSection`; replaces PR2.5's slug-blind stopgap.
   *
   * Lab Tests is still in scope for the slug seeding (so the lab path
   * can later read it), but the modal mount in Navbar continues to be
   * T61's BookingModal until PR4b ships the lab basket window.
   */
  const requestBookingForService = useCallback(
    (slug: ServiceSlug) => {
      setServiceSlug(slug);
      const verified =
        phoneVerifiedUntil !== null && phoneVerifiedUntil > Date.now();
      if (verified) {
        openModal();
      } else {
        setPending(true);
        openGate();
      }
    },
    [phoneVerifiedUntil, openModal, openGate, setServiceSlug],
  );

  /**
   * T85 PR4b — lab-basket variant. Seeds `bookingStore.serviceSlug =
   * 'lab-tests'` and opens the LabBasketWindow (not the
   * ServiceLedBookingModal). Same OTP-gate-then-modal dance as
   * `requestBookingForService` but the resume target is the lab
   * basket rather than the modal. Used by `ServiceSection`'s Lab
   * Tests CTA via the same per-service routing the other 3 CTAs use.
   *
   * Note the duplicated pending-state plumbing — `useBookingFlow`
   * carries a single `pending` flag, so a verified-mid-flight resume
   * needs to know which window to open. We dispatch on serviceSlug
   * inside the resume effect (see below) so a freshly-OTP-verified
   * patient who tapped Lab Tests lands in the basket, not the modal.
   */
  const requestBookingForLab = useCallback(() => {
    setServiceSlug("lab-tests");
    const verified =
      phoneVerifiedUntil !== null && phoneVerifiedUntil > Date.now();
    if (verified) {
      openLabBasket();
    } else {
      setPending(true);
      openGate();
    }
  }, [phoneVerifiedUntil, openLabBasket, openGate, setServiceSlug]);

  return { requestBooking, requestBookingForService, requestBookingForLab };
}
