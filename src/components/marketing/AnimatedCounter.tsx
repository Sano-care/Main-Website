"use client";

// T61 stats count-up animation. When the element enters viewport,
// counts from 0 to `value` over `duration` ms (default 1500), eased
// out, fires once per page load. Renders the rounded integer with
// optional prefix / suffix.
//
// Honors prefers-reduced-motion: renders `value` statically.
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
  const [displayValue, setDisplayValue] = useState(
    prefersReducedMotion ? value.toFixed(decimals) : (0).toFixed(decimals),
  );

  useEffect(() => {
    if (prefersReducedMotion) {
      setDisplayValue(value.toFixed(decimals));
      return;
    }
    if (!isInView) return;
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
