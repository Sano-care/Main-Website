"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useCmsSection } from "@/hooks/useCmsSection";
import { HOME_CONTENT } from "@/constants/cms-content";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export function Features() {
  const defaultServiceIcon = HOME_CONTENT.features.services[0].icon;
  const { data: featuresContent } = useCmsSection(
    "home",
    "features",
    HOME_CONTENT.features,
  );
  const sectionCopy = featuresContent.sectionCopy ?? HOME_CONTENT.features.sectionCopy;
  const services = featuresContent.services.map((service, index) => ({
    ...service,
    icon: service.icon ?? HOME_CONTENT.features.services[index]?.icon ?? defaultServiceIcon,
  }));

  return (
    <section className="py-24 lg:py-32 relative" id="services">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-16 gap-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <span className="text-primary font-bold tracking-widest text-xs uppercase mb-2 block">
              {sectionCopy.badge}
            </span>
            <h2 className="font-serif text-4xl lg:text-5xl font-medium text-text-main">
              {sectionCopy.title}
            </h2>
          </motion.div>
          <motion.a
            href={sectionCopy.aboutLinkHref}
            className="group flex items-center gap-2 pb-1 border-b border-text-main text-text-main font-medium hover:text-primary hover:border-primary transition-colors"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            {sectionCopy.aboutLinkLabel}
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </motion.a>
        </div>

        {/* Cards */}
        <motion.div
          className="grid md:grid-cols-2 lg:grid-cols-4 gap-6"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
        >
          {services.map((service) => {
            const Icon = typeof service.icon === "function" ? service.icon : defaultServiceIcon;
            return (
              <motion.div
                key={service.title}
                variants={cardVariants}
                className="group relative p-6 bg-white rounded-2xl shadow-sm border border-slate-100 hover:shadow-xl transition-all duration-300 flex flex-col"
              >
                <div className="size-12 rounded-xl bg-blue-50 text-primary flex items-center justify-center mb-5 group-hover:bg-primary group-hover:text-white transition-colors duration-300">
                  <Icon className="w-6 h-6" />
                </div>
                <h3 className="font-serif text-xl font-bold mb-2 text-text-main">
                  {service.title}
                </h3>
                <p className="text-text-secondary text-sm leading-relaxed mb-4">
                  {service.description}
                </p>
                <ul className="space-y-1.5 text-xs text-text-secondary mb-4 flex-1">
                  {service.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2">
                      <span className="size-1.5 rounded-full bg-primary" />
                      {feature}
                    </li>
                  ))}
                </ul>
                {/* Pricing Badge */}
                <div className="pt-4 border-t border-slate-100">
                  <span className="text-sm font-bold text-primary">{service.price}</span>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
