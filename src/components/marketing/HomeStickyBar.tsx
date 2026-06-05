"use client";

// Client wrapper around the B1 MobileStickyBar that wires its onBook to the
// shared booking flow. Lets the server-component homepage mount the sticky
// bottom CTA with a working "Book a Visit" trigger (gate→modal) rather than the
// component's scroll-to-top fallback.

import { MobileStickyBar } from "@/components/MobileStickyBar";
import { useBookingFlow } from "@/hooks/useBookingFlow";

export function HomeStickyBar() {
  const { requestBooking } = useBookingFlow();
  return <MobileStickyBar onBook={requestBooking} />;
}
