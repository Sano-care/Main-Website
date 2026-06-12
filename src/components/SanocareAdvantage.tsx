"use client";

import { motion } from "framer-motion";
import { 
  Check,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { useCmsSection } from "@/hooks/useCmsSection";
import { SANOCARE_ADVANTAGE_CONTENT } from "@/constants/cms-content";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const rowVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export function SanocareAdvantage() {
  const { data: pageCopy } = useCmsSection(
    "home",
    "sanocare_advantage_page_copy",
    SANOCARE_ADVANTAGE_CONTENT.pageCopy,
  );
  const { data: comparisonDataRaw } = useCmsSection(
    "home",
    "sanocare_advantage_comparison",
    SANOCARE_ADVANTAGE_CONTENT.comparisonData,
  );
  const { data: serviceOfferingsRaw } = useCmsSection(
    "home",
    "sanocare_advantage_service_offerings",
    SANOCARE_ADVANTAGE_CONTENT.serviceOfferings,
  );
  const { data: valuePropositions } = useCmsSection(
    "home",
    "sanocare_advantage_value_propositions",
    SANOCARE_ADVANTAGE_CONTENT.valuePropositions,
  );

  const comparisonData = {
    ...comparisonDataRaw,
    providers: comparisonDataRaw.providers.map((provider, index) => ({
      ...provider,
      icon: provider.icon ?? SANOCARE_ADVANTAGE_CONTENT.comparisonData.providers[index]?.icon ?? Check,
    })),
    features: comparisonDataRaw.features.map((feature, index) => ({
      ...feature,
      icon: feature.icon ?? SANOCARE_ADVANTAGE_CONTENT.comparisonData.features[index]?.icon ?? Check,
    })),
  };

  const serviceOfferings = serviceOfferingsRaw.map((service, index) => ({
    ...service,
    icon: service.icon ?? SANOCARE_ADVANTAGE_CONTENT.serviceOfferings[index]?.icon ?? Check,
    features: service.features.map((feature, featureIndex) => ({
      ...feature,
      icon:
        feature.icon
        ?? SANOCARE_ADVANTAGE_CONTENT.serviceOfferings[index]?.features[featureIndex]?.icon
        ?? Check,
    })),
  }));

  // T91: TraditionalIcon + SanocareIcon constants removed — the
  // consolidated comparison render iterates `comparisonData.providers`
  // and pulls the icon from each provider, so these aliases were
  // dual-render leftovers.

  return (
    <section className="py-20 lg:py-14 bg-slate-50 relative overflow-hidden" id="advantage">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-1/3 h-full bg-gradient-to-l from-primary/5 to-transparent pointer-events-none" />
      
      <div className="mx-auto max-w-[1400px] px-6 lg:px-12 relative z-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <span className="text-primary font-bold tracking-widest text-xs uppercase mb-2 block">
            {pageCopy.badge}
          </span>
          <h2 className="font-serif text-4xl lg:text-5xl font-medium text-text-main mb-4">
            {pageCopy.titlePrefix} <span className="text-primary italic">{pageCopy.titleHighlight}</span>
          </h2>
          <p className="text-text-secondary max-w-2xl mx-auto">
            {pageCopy.description}
          </p>
        </motion.div>

        {/* Comparison Table — consolidated render (T91).
            One source of truth for both mobile + desktop layouts.
            - Mobile (`grid-cols-3`):   Feature | Traditional | Sanocare
              (Telemedicine column hidden; cell text truncated to first
              token via the inline `<span className="md:hidden">` to
              preserve the narrow-viewport readability the dual-render
              targeted.)
            - Desktop (`md:grid-cols-4`): Feature | Traditional |
              Telemedicine | Sanocare, full text, larger padding. */}
        <motion.div
          className="bg-white rounded-2xl md:rounded-3xl shadow-xl border border-slate-100 overflow-hidden"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
        >
          {/* Table Header */}
          <div className="grid grid-cols-3 md:grid-cols-4 bg-slate-50 border-b border-slate-100">
            <div className="p-3 md:p-6 font-bold text-text-main text-xs md:text-base">
              <span className="md:hidden">Feature</span>
              <span className="hidden md:inline">{pageCopy.featureLabel}</span>
            </div>
            {comparisonData.providers.map((provider, providerIdx) => {
              const ProviderIcon = typeof provider.icon === "function" ? provider.icon : Check;
              // Middle provider (Telemedicine) is hidden on mobile.
              const isTelemedicine = providerIdx === 1;
              return (
                <div
                  key={provider.name}
                  className={`p-3 md:p-6 text-center ${
                    isTelemedicine ? "hidden md:flex md:flex-col md:items-center md:justify-center" : ""
                  } ${
                    provider.highlight ? "bg-primary text-white" : ""
                  }`}
                >
                  <div className="flex items-center justify-center gap-1 md:gap-2 font-bold text-xs md:text-base">
                    <ProviderIcon className="w-3.5 h-3.5 md:w-5 md:h-5" />
                    {provider.name}
                  </div>
                  <p
                    className={`hidden md:block text-xs mt-1 ${
                      provider.highlight ? "text-white/80" : "text-text-secondary"
                    }`}
                  >
                    {provider.description}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Table Rows */}
          {comparisonData.features.map((feature, index) => {
            const Icon = typeof feature.icon === "function" ? feature.icon : Check;
            return (
              <motion.div
                key={feature.name}
                variants={rowVariants}
                className={`grid grid-cols-3 md:grid-cols-4 ${
                  index !== comparisonData.features.length - 1 ? "border-b border-slate-100" : ""
                }`}
              >
                <div className="p-3 md:p-6 flex items-center gap-2 md:gap-3">
                  <div className="size-7 md:size-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <Icon className="w-3.5 h-3.5 md:w-5 md:h-5 text-slate-600" />
                  </div>
                  <span className="font-semibold text-text-main text-xs md:text-base">{feature.name}</span>
                </div>
                <div className="p-3 md:p-6 flex items-center justify-center text-center text-slate-500 md:text-slate-600 text-xs md:text-base">
                  <span className="md:hidden">{feature.traditional.split(" ")[0]}</span>
                  <span className="hidden md:inline">{feature.traditional}</span>
                </div>
                {/* Telemedicine column — desktop only */}
                <div className="hidden md:flex p-6 items-center justify-center text-center text-slate-600">
                  {feature.telemedicine}
                </div>
                <div className="p-3 md:p-6 flex items-center justify-center text-center bg-primary/5">
                  <span className="font-bold text-primary text-xs md:text-base">
                    <span className="md:hidden">{feature.sanocare.split(" ")[0]}</span>
                    <span className="hidden md:inline">{feature.sanocare}</span>
                  </span>
                </div>
              </motion.div>
            );
          })}
        </motion.div>

        {/* Service Models - Side by Side */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-16"
        >
          <h3 className="text-center font-serif text-2xl lg:text-3xl font-medium text-text-main mb-8">
            {pageCopy.serviceModelsTitle}
          </h3>
          
          {/* T91 (E-b): NOW + CareHub side-by-side from sm: (640px+)
              instead of md: (768px+) so tablet portrait shows the two
              cards rather than stacking. */}
          <div className="grid sm:grid-cols-2 gap-6">
            {serviceOfferings.map((service) => {
              const Icon = typeof service.icon === "function" ? service.icon : Check;
              const isPrimary = service.color === "primary";
              
              return (
                <motion.div
                  key={service.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${
                    isPrimary ? "border-primary/20" : "border-accent-coral/30"
                  }`}
                >
                  {/* Header */}
                  <div className={`p-5 lg:p-6 ${isPrimary ? "bg-gradient-to-r from-primary/5 to-primary-50" : "bg-accent-coral-50"}`}>
                    <div className="flex items-center gap-4 mb-4">
                      <div className={`p-3 rounded-xl ${isPrimary ? "bg-primary/10 text-primary" : "bg-accent-coral-50 text-[color:var(--color-accent-coral-dark)]"}`}>
                        <Icon className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="font-bold text-lg text-text-main">{service.name}</h4>
                        <p className="text-sm text-text-secondary">{service.tagline}</p>
                      </div>
                    </div>
                    
                    <p className="text-text-secondary text-sm leading-relaxed mb-4">
                      {service.description}
                    </p>
                    
                    {/* Features Grid */}
                    <div className="grid grid-cols-2 gap-2 mb-5">
                      {service.features.map((feature, idx) => {
                        const FeatureIcon = typeof feature.icon === "function" ? feature.icon : Check;
                        return (
                          <div key={idx} className="flex items-center gap-2 text-sm">
                            <FeatureIcon className={`w-4 h-4 shrink-0 ${isPrimary ? "text-primary" : "text-[color:var(--color-accent-coral-dark)]"}`} />
                            <span className="text-text-main text-xs lg:text-sm">{feature.text}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* CTA Buttons */}
                    <div className="flex flex-col sm:flex-row gap-3">
                      <Link
                        href={service.ctaLink}
                        className={`flex-1 inline-flex items-center justify-center gap-2 text-white font-semibold py-3 px-4 rounded-xl hover:opacity-90 transition-opacity text-sm ${
                          isPrimary ? "bg-primary" : "bg-accent-coral"
                        }`}
                      >
                        {service.cta}
                        <ArrowRight className="w-4 h-4" />
                      </Link>
                      <Link
                        href={service.learnMore}
                        className={`flex-1 inline-flex items-center justify-center gap-2 border font-semibold py-3 px-4 rounded-xl hover:bg-white/50 transition-colors text-sm ${
                          isPrimary ? "border-primary/20 text-primary" : "border-accent-coral/30 text-[color:var(--color-accent-coral-dark)]"
                        }`}
                      >
                        Learn More
                      </Link>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>

        {/* Value Propositions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-16 grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4"
        >
          {valuePropositions.map((item, index) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="bg-white rounded-xl p-4 lg:p-5 border border-slate-100 hover:border-primary/30 hover:shadow-lg transition-all group"
            >
              <div className="flex items-start gap-2 lg:gap-3">
                <div className="size-7 lg:size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary group-hover:text-white transition-colors">
                  <Check className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-primary group-hover:text-white" />
                </div>
                <div>
                  <h4 className="font-bold text-text-main text-xs lg:text-sm">{item.title}</h4>
                  <p className="text-xs text-text-secondary mt-0.5 hidden sm:block">{item.description}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-12 text-center"
        >
          <Link
            href="/services"
            className="inline-flex items-center gap-2 text-primary font-semibold hover:underline"
          >
            {pageCopy.exploreAllLabel}
            <ArrowRight className="w-4 h-4" />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
