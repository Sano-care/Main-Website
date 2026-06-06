"use client";

import { motion } from "framer-motion";
import { useInView } from "framer-motion";
import { useRef } from "react";
import { useCmsSection } from "@/hooks/useCmsSection";
import { HOME_CONTENT } from "@/constants/cms-content";
import { AnimatedCounter } from "@/components/marketing/AnimatedCounter";

// Split a CMS stat string into an optional non-numeric prefix (e.g. "<"), a
// numeric value, and its decimal count, so the count-up animates the number
// while keeping any prefix. Returns null for values with no parseable number
// (rendered statically). Note: thousands separators are dropped during the
// count-up (AnimatedCounter has no grouping) — "1,000" animates to "1000".
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
      <span className="text-2xl text-primary">{suffix}</span>
    </motion.div>
  );
}

export function StatsBar() {
  const { data: statsBarContent } = useCmsSection(
    "home",
    "stats_bar",
    HOME_CONTENT.statsBar,
  );
  const stats = statsBarContent.stats;

  return (
    <section className="relative py-20 bg-text-main text-white overflow-hidden">
      {/* Dot pattern background */}
      <div 
        className="absolute inset-0 opacity-10" 
        style={{ 
          backgroundImage: "radial-gradient(#ffffff 1px, transparent 1px)", 
          backgroundSize: "32px 32px" 
        }} 
      />
      
      <div className="mx-auto max-w-[1400px] px-6 lg:px-12 relative z-10">
        <div className="grid lg:grid-cols-4 gap-12 items-start pt-4">
          {/* Left heading */}
          <motion.div 
            className="lg:col-span-1"
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-serif text-3xl font-bold mb-4">
              Numbers that<br />
              <span className="text-primary italic">Matter</span>
            </h2>
            <p className="text-white/60 text-sm leading-relaxed">
              Our commitment to excellence is reflected in our data. Transparency and trust are the pillars of our practice.
            </p>
          </motion.div>
          
          {/* Stats grid */}
          <div className="lg:col-span-3 grid sm:grid-cols-3 gap-8">
            {stats.map((stat, index) => (
              <motion.div
                key={stat.label}
                className="group"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
              >
                <AnimatedNumber value={stat.value} suffix={stat.suffix} />
                <p className="mt-2 font-medium text-lg border-l-2 border-primary/50 pl-3">
                  {stat.label}
                </p>
                <p className="mt-2 text-sm text-white/50 pl-3.5">
                  {stat.subtext}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
