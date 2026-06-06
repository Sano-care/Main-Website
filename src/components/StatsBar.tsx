"use client";

// T85 PR2 — "Numbers" band, rebuilt from brief copy.
//
// Replaces the T61 CMS-driven version: brief Section 5 specifies four
// exact stat pairings + new heading copy, so the CMS path is bypassed
// here. If we ever want CMS overrides for these specific copy strings,
// the seam is `STATS` below — lift it out to a hook, but for now
// hardcoded is honest about where the source-of-truth lives.
//
// Brief copy (verbatim):
//   eyebrow — "Numbers that matter" (lowercase "matter", no italics)
//   H2      — "Built on real care."
//   stats (4, in order):
//     1,000+   →  Home-Visits delivered
//     4.7★     →  75 Google reviews
//     <30 min  →  Median response
//     1,892    →  Lab tests catalogued
//
// AnimatedNumber parses a numeric value from the leading "value" string
// and animates the count-up on viewport entry. Non-numeric prefixes
// (e.g. "<") are preserved; thousands separators are stripped during
// the animation (AnimatedCounter has no grouping) — "1,000" animates as
// "1000" then settles back to whatever the suffix produces visually.

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { AnimatedCounter } from "@/components/marketing/AnimatedCounter";

interface Stat {
  /** Numeric portion (may include "<" prefix, commas). */
  value: string;
  /** Trailing text appended after the number — "+", "★", "min", "". */
  suffix: string;
  /** Label below the number. */
  label: string;
}

const STATS: ReadonlyArray<Stat> = [
  { value: "1,000", suffix: "+", label: "Home-Visits delivered" },
  { value: "4.7", suffix: "★", label: "75 Google reviews" },
  { value: "<30", suffix: "min", label: "Median response" },
  { value: "1,892", suffix: "", label: "Lab tests catalogued" },
];

function parseStatValue(
  value: string,
): { prefix: string; num: number; decimals: number } | null {
  const m = value.match(/^([^\d.-]*)([\d,.]+)$/);
  if (!m) return null;
  const prefix = m[1] ?? "";
  const numStr = m[2].replace(/,/g, "");
  const num = parseFloat(numStr);
  if (!Number.isFinite(num)) return null;
  const dot = numStr.indexOf(".");
  const decimals = dot >= 0 ? numStr.length - dot - 1 : 0;
  return { prefix, num, decimals };
}

function AnimatedNumber({ value, suffix }: { value: string; suffix: string }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });
  const parsed = parseStatValue(value);

  return (
    <motion.div
      ref={ref}
      className="flex items-baseline gap-1"
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5 }}
    >
      <span className="font-serif text-5xl lg:text-6xl font-medium">
        {parsed ? (
          <AnimatedCounter
            value={parsed.num}
            prefix={parsed.prefix}
            decimals={parsed.decimals}
          />
        ) : (
          value
        )}
      </span>
      {suffix && <span className="text-2xl text-primary">{suffix}</span>}
    </motion.div>
  );
}

export function StatsBar() {
  return (
    <section className="relative py-20 bg-text-main text-white overflow-hidden">
      {/* Dot pattern background */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage:
            "radial-gradient(#ffffff 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      <div className="mx-auto max-w-[1400px] px-6 lg:px-12 relative z-10">
        {/* Header — eyebrow + H2 */}
        <motion.div
          className="mb-12 max-w-2xl"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <span className="block text-[11px] font-bold uppercase tracking-[0.8px] text-white/85 mb-3">
            Numbers that matter
          </span>
          <h2 className="font-serif text-3xl lg:text-4xl font-bold">
            Built on real care.
          </h2>
        </motion.div>

        {/* 4-stat grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {STATS.map((stat, index) => (
            <motion.div
              key={stat.label}
              className="group"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <AnimatedNumber value={stat.value} suffix={stat.suffix} />
              <p className="mt-2 font-medium text-base lg:text-lg border-l-2 border-primary/50 pl-3">
                {stat.label}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
