"use client";

// T61 scroll-triggered fade/slide-up reveal. Wraps any section in a
// motion.div that fades from opacity 0 → 1 and translates from
// translateY(20px) → 0 over 400ms when ≥15% of the element is in
// viewport. Fires exactly once per section per page load.
//
// Honors prefers-reduced-motion: renders content statically with no
// transforms when the preference is set.
//
// Usage:
//   <SectionReveal>
//     <section>…</section>
//   </SectionReveal>
//
// Optional `delay` prop (ms) for stagger sequences. Default 0.

import { motion, useReducedMotion } from "framer-motion";
import { ReactNode } from "react";

interface SectionRevealProps {
  children: ReactNode;
  /** Stagger delay in milliseconds. Default 0. */
  delay?: number;
  /** Visibility threshold — fraction of element in viewport before triggering. Default 0.15. */
  threshold?: number;
  /** Override the wrapping element. Default 'div'. */
  as?: "div" | "section" | "article";
  className?: string;
}

export function SectionReveal({
  children,
  delay = 0,
  threshold = 0.15,
  as = "div",
  className,
}: SectionRevealProps) {
  const prefersReducedMotion = useReducedMotion();

  // No motion at all if the user has reduced-motion preference set —
  // render the children inline.
  if (prefersReducedMotion) {
    const Plain = as;
    return <Plain className={className}>{children}</Plain>;
  }

  const MotionTag =
    as === "section" ? motion.section : as === "article" ? motion.article : motion.div;

  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: threshold }}
      transition={{
        duration: 0.4,
        ease: [0.22, 1, 0.36, 1],
        delay: delay / 1000,
      }}
    >
      {children}
    </MotionTag>
  );
}
