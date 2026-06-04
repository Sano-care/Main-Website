"use client";

// T61 reusable "Ready to book?" strip. Drops in after any section in
// the booking-density sweep with section-specific copy to match the
// patient's mental model:
//
//   After Hero / Quick Book:  "Ready to book?"
//   After Lab Search:         "Need this test? Book free home collection →"
//   After Numbers:            "Join 1,000+ families →"
//   After Services:           "Book one of these →"
//   After Care Journey:       "Start your visit in 60 seconds →"
//
// Tap on the CTA fires the prop `onBook` (caller wires through to the
// existing BookingGate → BookingModal flow via the homepage's Navbar
// store actions; see page.tsx wiring).
//
// Tap-scale on the button per the brief's motion principles
// (active:scale-[0.97], 100ms).

import { ArrowRight } from "lucide-react";

interface BookingCTAStripProps {
  /** Headline above the CTA. */
  headline: string;
  /** Optional sub-copy beneath the headline. */
  subline?: string;
  /** Button label. Defaults to "Book a Visit". */
  ctaLabel?: string;
  /** Click handler — wire to the BookingGate/Modal flow. */
  onBook: () => void;
  /** Optional className overrides for the outer wrapper. */
  className?: string;
}

export function BookingCTAStrip({
  headline,
  subline,
  ctaLabel = "Book a Visit",
  onBook,
  className,
}: BookingCTAStripProps) {
  return (
    <div
      className={
        "bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/15 rounded-2xl px-6 py-8 sm:px-8 sm:py-10 max-w-3xl mx-auto text-center " +
        (className ?? "")
      }
    >
      <h3 className="text-xl sm:text-2xl font-bold text-slate-900 mb-2">
        {headline}
      </h3>
      {subline && (
        <p className="text-sm text-slate-600 mb-5 max-w-xl mx-auto">{subline}</p>
      )}
      <button
        type="button"
        onClick={onBook}
        className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark text-white font-semibold py-3 px-6 rounded-full shadow-md hover:shadow-lg transition-all active:scale-[0.97]"
      >
        {ctaLabel}
        <ArrowRight className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
