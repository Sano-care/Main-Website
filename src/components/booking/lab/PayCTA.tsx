"use client";

// T85 PR4b — sticky-bottom Proceed to Pay CTA + reassurance note.
// Lives outside the scrollable basket body (sibling of the scroller
// in LabBasketWindow) so the CTA is always reachable regardless of
// basket height.

import { ArrowRight, Loader2 } from "lucide-react";

interface PayCTAProps {
  grandTotalInr: number;
  disabled: boolean;
  submitting: boolean;
  onClick: () => void;
}

export function PayCTA({
  grandTotalInr,
  disabled,
  submitting,
  onClick,
}: PayCTAProps) {
  return (
    <div className="flex-shrink-0 border-t border-slate-100 bg-white px-5 lg:px-6 py-3 space-y-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || submitting}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[color:var(--color-accent-coral)] hover:bg-[color:var(--color-accent-coral-dark)] disabled:opacity-60 disabled:cursor-not-allowed text-white text-[15px] font-semibold py-3.5 transition-colors shadow-[0_8px_18px_rgba(244,132,90,0.36),0_2px_4px_rgba(244,132,90,0.20)]"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Opening payment&hellip;
          </>
        ) : (
          <>
            Proceed to Pay ₹{grandTotalInr.toLocaleString("en-IN")}
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
      <p className="text-center text-[11px] text-text-secondary">
        Tests process only after payment confirmed
      </p>
    </div>
  );
}
