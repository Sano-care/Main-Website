"use client";

// Sticky bottom action bar for the Pulse surfaces.
//
// The marketing MobileStickyBar (src/components/MobileStickyBar.tsx) is wired
// to CMS copy + the homepage hero booking form + a call button, so it can't be
// dropped into a clinical surface verbatim. This is the faithful Pulse variant:
// same pattern (fixed bottom, mobile-first, spring slide-in, whileTap press)
// but presentational and single-action. It slides up on mount and stays put —
// the interior Pulse pages are short and the primary action ("Log a vital",
// "Add medication") should always be one thumb-reach away.
//
// prefers-reduced-motion: skips the slide/press animations (static bar).

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

export function PulseStickyBar({
  onClick,
  children,
  ariaLabel,
}: {
  onClick: () => void;
  children: ReactNode;
  ariaLabel?: string;
}) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-sm"
      initial={prefersReducedMotion ? false : { y: 80 }}
      animate={{ y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <div className="mx-auto max-w-2xl">
        <motion.button
          type="button"
          onClick={onClick}
          aria-label={ariaLabel}
          whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-4 text-sm font-bold text-white shadow-lg shadow-primary/30"
        >
          {children}
        </motion.button>
      </div>
    </motion.div>
  );
}
