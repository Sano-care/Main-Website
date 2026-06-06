"use client";

import { useCallback, useEffect, useState } from "react";

import { useBookingStore } from "@/store/bookingStore";

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
  const phoneVerifiedUntil = useBookingStore((s) => s.phoneVerifiedUntil);

  const [pending, setPending] = useState(false);

  // `Date.now()` is read inside the effect / callback only (never during
  // render) so the hook stays render-pure. `phoneVerifiedUntil` changing is
  // what re-runs the effect after a successful OTP, resuming into the modal.
  useEffect(() => {
    const verified =
      phoneVerifiedUntil !== null && phoneVerifiedUntil > Date.now();
    if (pending && verified) {
      setPending(false);
      openModal();
    }
  }, [pending, phoneVerifiedUntil, openModal]);

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

  return { requestBooking };
}
