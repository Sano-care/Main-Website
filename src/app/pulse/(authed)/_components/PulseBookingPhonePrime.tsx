"use client";

import { useEffect } from "react";

import { useBookingStore } from "@/store/bookingStore";

import { useCurrentCustomer } from "../../_lib/PulseCustomerContext";

/**
 * T90 Pulse v1 Phase 1 Slice 2 — bookingStore phone-verified prime
 * (founder Step-11 decision (B)).
 *
 * Pulse-authed users are already past the OTP wall (the OTP-verify
 * cookie is the actual auth artifact, validated server-side on every
 * /api/pulse/* hit). The booking flow has a SEPARATE in-memory cache
 * `bookingStore.phoneVerifiedUntil` that controls whether
 * `requestBookingForService()` / `requestBookingForLab()` open the
 * BookingGate (OTP modal) or go straight to the modal/basket.
 *
 * Without this prime, a Pulse-authed user tapping a tile would see
 * the BookingGate the FIRST time per browser session — a confusing
 * re-OTP-prompt after they're already signed in.
 *
 * This component fires once per home mount and seeds the bookingStore
 * with the live customer's phone + full_name + a TTL that matches
 * exactly what a fresh OTP verify writes (see BookingGate's
 * TOKEN_TTL_MS — itself a mirror of the server-side OTP token TTL).
 *
 * Renders null. Lives at the (authed) home page level so it primes
 * on every /pulse load.
 */

// Mirror of BookingGate.tsx#TOKEN_TTL_MS (which mirrors token.ts#TOKEN_TTL_SECONDS).
// Keep in sync with both — Pulse-authed users are treated as if they had
// just freshly OTP-verified through the booking gate.
const POST_VERIFY_TTL_MS = 30 * 60 * 1000;

export default function PulseBookingPhonePrime() {
  const customer = useCurrentCustomer();

  useEffect(() => {
    // Pull the setter directly from getState() — using a selector here
    // would needlessly re-prime on every store change. The effect's
    // dep array is the customer fields; the setter is stable.
    const setPhoneVerified = useBookingStore.getState().setPhoneVerified;
    setPhoneVerified(
      customer.phone,
      Date.now() + POST_VERIFY_TTL_MS,
      customer.full_name,
    );
  }, [customer.phone, customer.full_name]);

  return null;
}
