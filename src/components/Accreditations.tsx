"use client";

import { motion } from "framer-motion";
import { useCmsSection } from "@/hooks/useCmsSection";
import { HOME_CONTENT } from "@/constants/cms-content";

export function Accreditations() {
  const defaultTrustIcon = HOME_CONTENT.trust.badges[0].icon;
  const { data: trustContent } = useCmsSection(
    "home",
    "trust",
    HOME_CONTENT.trust,
  );
  const trustBadges = trustContent.badges.map((badge, index) => ({
    ...badge,
    icon: badge.icon ?? HOME_CONTENT.trust.badges[index]?.icon ?? defaultTrustIcon,
  }));

  return (
    <section className="border-t border-slate-200 bg-white/50 py-16" id="trust">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
        <motion.p
          className="mb-10 text-center text-xs font-bold uppercase tracking-widest text-text-secondary/70"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
        >
          {trustContent.sectionTitle ?? HOME_CONTENT.trust.sectionTitle}
        </motion.p>
        <motion.div
          className="flex flex-wrap items-center justify-center gap-8 lg:gap-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          {trustBadges.map((item, index) => {
            const Icon = typeof item.icon === "function" ? item.icon : defaultTrustIcon;
            return (
              <motion.div
                key={item.name}
                className="flex flex-col items-center gap-2 group cursor-default"
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <div className="size-14 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <Icon className="w-7 h-7 text-primary" />
                </div>
                <span className="font-bold text-sm text-text-main text-center">{item.name}</span>
                <span className="text-xs text-text-secondary text-center">{item.description}</span>
              </motion.div>
            );
          })}
        </motion.div>

        <motion.div
          className="mt-12 pt-8 border-t border-slate-100 flex flex-wrap items-center justify-center gap-6 text-xs text-text-secondary"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
        >
          {trustContent.metrics.map((line, index) => (
            <span key={line} className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-green-500" />
              {line}
              {index < trustContent.metrics.length - 1 ? (
                <span className="hidden sm:block">•</span>
              ) : null}
            </span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
