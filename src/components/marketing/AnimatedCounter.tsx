"use client";

// T61 stats count-up animation. When the element enters viewport,
// counts from 0 to `value` over `duration` ms (default 1500), eased
// out, fires once per page load. Renders the rounded integer with
// optional prefix / suffix.
//
// Honors prefers-reduced-motion: renders `value` statically.
//
// T91 (2026-06-13) — SSR-correctness fix. Initial state is now the
// final `value` (not `0`), so SSR HTML + first paint show the real
// number. On the client, the effect resets to `0` just before
// animating up — preserves the count-up motion for users who scroll
// into the band, while crawlers / Lighthouse / no-JS users see the
// correct values instead of zeros. Users whose StatsBar is already
// in viewport at first paint won't see the animation, but they
// wouldn't have either way without scroll motion to trigger the
// IntersectionObserver — so the visible behaviour is identical for
// that edge case.
//
// Designed for the StatsBar / "Numbers that Matter" strip (large
// dramatic numbers in a dedicated section). NOT applied to the Hero
// micro-trust strip per founder direction — animation there would
// compete with the H1 + CTAs in the critical first-3-second scan.
//
// Usage:
//   <AnimatedCounter value={1000} suffix="+" />
//   <AnimatedCounter value={4.7} decimals={1} />

import { motion, useInView, useMotionValue, useReducedMotion, useTransform, animate } from "framer-motion";
import { useEffect, useRef, useState } from "react";

interface AnimatedCounterProps {
  value: number;
  /** Optional prefix rendered before the number, e.g. "₹". */
  prefix?: string;
  /** Optional suffix rendered after the number, e.g. "+" / "%". */
  suffix?: string;
  /** Decimal places — 0 by default (integers). */
  decimals?: number;
  /** Animation duration in ms. Default 1500. */
  duration?: number;
  /** Visibility threshold to trigger the count. Default 0.5 (half visible). */
  amount?: number;
  className?: string;
}

export function AnimatedCounter({
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  duration = 1500,
  amount = 0.5,
  className,
}: AnimatedCounterProps) {
  const prefersReducedMotion = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, amount });
  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (latest) => {
    const factor = Math.pow(10, decimals);
    return (Math.round(latest * factor) / factor).toFixed(decimals);
  });
  // T91: SSR + first paint render the final value so crawlers and
  // no-JS readers see real numbers. The effect resets to 0 only on
  // the client, right before the count-up animation starts.
  const [displayValue, setDisplayValue] = useState(value.toFixed(decimals));

  useEffect(() => {
    if (prefersReducedMotion) return; // already showing final value
    if (!isInView) return;
    // T91: cascading-render warning is the intended behaviour here —
    // we need React to flush displayValue back to "0" on the client
    // before framer-motion's animate() starts driving it back up to
    // the final value. The reset bridges React state to the external
    // animation system (the documented exception in the rule's docs).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDisplayValue((0).toFixed(decimals));
    const controls = animate(motionValue, value, {
      duration: duration / 1000,
      ease: [0.22, 1, 0.36, 1],
    });
    const unsubscribe = rounded.on("change", (v) => setDisplayValue(v));
    return () => {
      controls.stop();
      unsubscribe();
    };
  }, [isInView, value, duration, decimals, motionValue, rounded, prefersReducedMotion]);

  return (
    <motion.span ref={ref} className={className}>
      {prefix}
      {displayValue}
      {suffix}
    </motion.span>
  );
}
