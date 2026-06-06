"use client";

// Client wrapper that lets the (server-component) homepage drop a
// BookingCTAStrip between sections without threading a click handler down from
// a client island. It owns a useBookingFlow() instance and hands its
// requestBooking to the strip's onBook — so every density CTA opens the same
// gate→modal flow the Navbar button does.

import { BookingCTAStrip } from "@/components/marketing/BookingCTAStrip";
import { useBookingFlow } from "@/hooks/useBookingFlow";

export function BookingCTASection({
  headline,
  subline,
  ctaLabel,
  className,
}: {
  headline: string;
  subline?: string;
  ctaLabel?: string;
  className?: string;
}) {
  const { requestBooking } = useBookingFlow();
  return (
    <div className="px-4 sm:px-6 lg:px-12 py-8 sm:py-10">
      <BookingCTAStrip
        headline={headline}
        subline={subline}
        ctaLabel={ctaLabel}
        onBook={requestBooking}
        className={className}
      />
    </div>
  );
}
