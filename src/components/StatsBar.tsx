"use client";

import { motion } from "framer-motion";
import { useInView } from "framer-motion";
import { useRef } from "react";
import { useCmsSection } from "@/hooks/useCmsSection";
import { HOME_CONTENT } from "@/constants/cms-content";

function AnimatedNumber({ value, suffix }: { value: string; suffix: string }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  return (
    <motion.div
      ref={ref}
      className="flex items-baseline gap-1"
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5 }}
    >
      <span className="font-serif text-5xl lg:text-6xl font-medium">{value}</span>
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
