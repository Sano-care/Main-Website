"use client";

import { motion } from "framer-motion";
import { 
  Zap, 
  CheckCircle2, 
  ArrowRight,
  Phone,
  Timer,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui";
import { useCmsSection } from "@/hooks/useCmsSection";
import { NOW_PAGE_CONTENT } from "@/constants/cms-content";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export default function SanocareNowPage() {
  const { data: nowPageCopy } = useCmsSection(
    "now",
    "page_copy",
    NOW_PAGE_CONTENT.pageCopy,
  );
  const { data: nowServices } = useCmsSection(
    "now",
    "services",
    NOW_PAGE_CONTENT.services,
  );
  const { data: nowHowItWorks } = useCmsSection(
    "now",
    "how_it_works",
    NOW_PAGE_CONTENT.howItWorks,
  );
  const { data: nowAdvantages } = useCmsSection(
    "now",
    "advantages",
    NOW_PAGE_CONTENT.advantages,
  );
  const { data: nowStats } = useCmsSection(
    "now",
    "stats",
    NOW_PAGE_CONTENT.stats,
  );
  const { data: pricingPoints } = useCmsSection(
    "now",
    "pricing_points",
    NOW_PAGE_CONTENT.pricingPoints,
  );
  const { data: trustPoints } = useCmsSection(
    "now",
    "trust_points",
    NOW_PAGE_CONTENT.trustPoints,
  );

  const services = nowServices.map((service, index) => ({
    ...service,
    icon: service.icon ?? NOW_PAGE_CONTENT.services[index]?.icon ?? Zap,
  }));
  const howItWorks = nowHowItWorks.map((item, index) => ({
    ...item,
    icon: item.icon ?? NOW_PAGE_CONTENT.howItWorks[index]?.icon ?? Phone,
  }));
  const advantages = nowAdvantages;
  const stats = nowStats.map((stat, index) => ({
    ...stat,
    icon: stat.icon ?? NOW_PAGE_CONTENT.stats[index]?.icon ?? Timer,
  }));

  return (
    <main className="min-h-screen bg-background-light relative overflow-x-hidden">
      {/* Background Decorations */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[20%] -right-[10%] w-[60vw] h-[60vw] rounded-full bg-gradient-to-br from-primary/5 to-transparent blur-3xl opacity-60" />
        <div className="absolute -bottom-[20%] -left-[10%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-tr from-blue-50 to-transparent blur-3xl opacity-60" />
      </div>

      <div className="relative z-10">
        <Navbar />
        
        {/* Hero Section */}
        <section className="relative pt-16 pb-16 lg:pt-28 lg:pb-28 overflow-hidden">
          <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
            <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
              {/* Left Content */}
              <motion.div
                className="flex flex-col gap-6 lg:gap-8"
                initial={{ opacity: 0, x: -30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6 }}
              >
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-primary shadow-sm">
                  <Zap className="size-3.5" />
                  {nowPageCopy.hero.badge}
                </div>
                
                <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-medium leading-[1.1] tracking-tight text-text-main">
                  {nowPageCopy.hero.titlePrefix} <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-600 italic">{nowPageCopy.hero.titleHighlight}</span>
                </h1>
                
                <p className="text-lg lg:text-xl leading-relaxed text-text-secondary max-w-xl font-light">
                  {nowPageCopy.hero.description}
                </p>
                
                <div className="flex flex-wrap gap-4 pt-4">
                  <Link href={nowPageCopy.hero.primaryCtaHref}>
                    <Button className="rounded-full px-8 py-4 bg-primary hover:bg-primary-dark shadow-xl shadow-primary/20 hover:-translate-y-1 transition-transform">
                      {nowPageCopy.hero.primaryCtaLabel}
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                  <a href={nowPageCopy.hero.secondaryCtaHref}>
                    <Button variant="outline" className="rounded-full px-8 py-4 border-slate-200 hover:border-primary/30">
                      <Phone className="w-4 h-4" />
                      {nowPageCopy.hero.secondaryCtaLabel}
                    </Button>
                  </a>
                </div>
              </motion.div>
              
              {/* Right Image */}
              <motion.div
                className="relative"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                <div className="aspect-[4/3] rounded-[2rem] overflow-hidden shadow-2xl relative z-10 border-8 border-white">
                  <Image
                    src={nowPageCopy.hero.imageSrc}
                    alt={nowPageCopy.hero.imageAlt}
                    fill
                    className="object-cover"
                    priority
                  />
                </div>
                
                {/* Floating Card */}
                <motion.div
                  className="absolute -bottom-6 -left-6 bg-white/80 backdrop-blur-xl p-5 rounded-2xl shadow-xl z-20 max-w-[200px] border border-white/50"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <Timer className="w-5 h-5 text-primary" />
                    <span className="text-xs font-bold uppercase tracking-widest">{nowPageCopy.hero.floatingCardLabel}</span>
                  </div>
                  <p className="text-[11px] text-text-secondary">{nowPageCopy.hero.floatingCardText}</p>
                </motion.div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Stats Bar */}
        <section className="py-12 bg-white border-y border-slate-100">
          <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
            <motion.div
              className="grid grid-cols-2 lg:grid-cols-4 gap-8"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              {stats.map((stat, index) => {
                const Icon = typeof stat.icon === "function" ? stat.icon : Timer;
                return (
                  <motion.div
                    key={index}
                    className="flex items-center gap-4 justify-center lg:justify-start"
                    initial={{ opacity: 0, y: 10 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <div className="size-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Icon className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <div className="text-2xl lg:text-3xl font-bold text-text-main">{stat.value}</div>
                      <div className="text-sm font-medium text-text-secondary">{stat.label}</div>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        </section>

        {/* Services Grid */}
        <section className="py-20 lg:py-28 bg-white" id="services">
          <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
            <motion.div
              className="text-center mb-16 max-w-2xl mx-auto"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <span className="text-primary font-bold tracking-widest text-xs uppercase mb-3 block">
                {nowPageCopy.servicesSection.badge}
              </span>
              <h2 className="font-serif text-3xl lg:text-5xl font-medium text-text-main mb-6">
                {nowPageCopy.servicesSection.title}
              </h2>
              <p className="text-text-secondary font-light">
                {nowPageCopy.servicesSection.description}
              </p>
            </motion.div>

            <motion.div
              variants={containerVariants}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8"
            >
              {services.map((service, index) => {
                const Icon = typeof service.icon === "function" ? service.icon : Zap;
                return (
                  <motion.div
                    key={index}
                    variants={itemVariants}
                    className="group relative p-8 lg:p-10 bg-white rounded-2xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-100 transition-all duration-300 hover:shadow-2xl hover:-translate-y-2"
                  >
                    <div className="flex items-start justify-between mb-6">
                      <div className="size-14 rounded-xl bg-primary/10 text-primary flex items-center justify-center transition-all duration-300 group-hover:bg-primary group-hover:text-white group-hover:scale-110">
                        <Icon className="w-7 h-7" />
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-primary">{service.price}</div>
                        <div className="text-xs text-text-secondary font-medium">{service.duration}</div>
                      </div>
                    </div>
                    <h3 className="font-serif text-xl font-bold mb-3 text-text-main">
                      {service.title}
                    </h3>
                    <p className="text-text-secondary text-sm leading-relaxed">
                      {service.description}
                    </p>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-20 lg:py-28 relative overflow-hidden">
          <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
            <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
              {/* Left Image */}
              <motion.div
                className="relative order-2 lg:order-1"
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
              >
                <div className="aspect-square rounded-3xl overflow-hidden shadow-2xl relative">
                  <Image
                    src={nowPageCopy.processSection.imageSrc}
                    alt={nowPageCopy.processSection.imageAlt}
                    fill
                    className="object-cover"
                  />
                </div>
                <div className="absolute -bottom-12 -right-12 size-64 bg-primary/20 rounded-full blur-3xl -z-10" />
              </motion.div>
              
              {/* Right Content */}
              <motion.div
                className="order-1 lg:order-2"
                initial={{ opacity: 0, x: 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
              >
                <span className="text-primary font-bold tracking-widest text-xs uppercase mb-3 block">
                  {nowPageCopy.processSection.badge}
                </span>
                <h2 className="font-serif text-3xl lg:text-5xl font-medium text-text-main mb-6 lg:mb-8">
                  {nowPageCopy.processSection.title}
                </h2>
                <p className="text-lg text-text-secondary font-light leading-relaxed mb-10 lg:mb-12">
                  {nowPageCopy.processSection.description}
                </p>
                
                <div className="space-y-8">
                  {howItWorks.map((item, index) => {
                    const Icon = typeof item.icon === "function" ? item.icon : Phone;
                    return (
                      <motion.div
                        key={item.step}
                        className="flex gap-6 group"
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: index * 0.1 }}
                      >
                        <div className="relative">
                          <span className="text-4xl lg:text-5xl font-serif text-primary opacity-30 group-hover:opacity-100 transition-opacity duration-300">
                            {item.step}
                          </span>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <Icon className="w-5 h-5 text-primary" />
                            <h3 className="text-lg lg:text-xl font-bold text-text-main">
                              {item.title}
                            </h3>
                          </div>
                          <p className="text-text-secondary text-sm leading-relaxed">
                            {item.description}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Why Choose Us */}
        <section className="py-20 lg:py-28 bg-white">
          <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
            <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
              {/* Left */}
              <motion.div
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
              >
                <span className="text-primary font-bold tracking-widest text-xs uppercase mb-3 block">
                  {nowPageCopy.advantagesSection.badge}
                </span>
                <h2 className="font-serif text-3xl lg:text-5xl font-medium text-text-main mb-8">
                  {nowPageCopy.advantagesSection.title}
                </h2>
                
                <div className="space-y-8">
                  {advantages.map((item, index) => (
                    <motion.div
                      key={index}
                      className="flex gap-6"
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: index * 0.1 }}
                    >
                      <span className="text-5xl font-serif text-primary/20">
                        0{index + 1}
                      </span>
                      <div>
                        <h3 className="text-xl font-bold text-text-main mb-2">
                          {item.title}
                        </h3>
                        <p className="text-text-secondary leading-relaxed">
                          {item.description}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
              
              {/* Right - Pricing Card */}
              <motion.div
                initial={{ opacity: 0, x: 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
              >
                <div className="bg-gradient-to-br from-primary/5 via-blue-50/50 to-white rounded-3xl p-8 lg:p-10 border border-primary/10 shadow-xl">
                  <div className="text-center mb-8">
                    <span className="text-primary font-bold tracking-widest text-xs uppercase">{nowPageCopy.pricingCard.badge}</span>
                    <div className="mt-4">
                      <span className="text-sm text-text-secondary">{nowPageCopy.pricingCard.startingAtLabel}</span>
                      <div className="text-6xl font-bold text-primary mt-1">{nowPageCopy.pricingCard.price}</div>
                      <span className="text-sm text-text-secondary">{nowPageCopy.pricingCard.subtitle}</span>
                    </div>
                  </div>
                  
                  <div className="space-y-4 mb-8">
                    {pricingPoints.map((item, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                        <span className="text-text-main text-sm">{item}</span>
                      </div>
                    ))}
                  </div>
                  
                  <Link href={nowPageCopy.pricingCard.ctaHref}>
                    <Button variant="primary" size="lg" className="w-full rounded-full shadow-lg shadow-primary/20">
                      {nowPageCopy.pricingCard.ctaLabel}
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Trust Section - Dark */}
        <section className="py-20 lg:py-28 bg-text-main overflow-hidden relative">
          <div className="absolute inset-0 opacity-10 pointer-events-none">
            <div 
              className="absolute top-0 left-0 w-full h-full"
              style={{
                backgroundImage: "radial-gradient(circle at 2px 2px, rgba(255,255,255,0.1) 1px, transparent 0)",
                backgroundSize: "40px 40px",
              }}
            />
          </div>
          
          <div className="mx-auto max-w-[1400px] px-6 lg:px-12 relative z-10">
            <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
              <motion.div
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
              >
                <span className="text-primary font-bold tracking-widest text-xs uppercase mb-3 block">
                  {nowPageCopy.trustSection.badge}
                </span>
                <h2 className="font-serif text-3xl lg:text-5xl font-medium text-white mb-6">
                  {nowPageCopy.trustSection.title}
                </h2>
                <p className="text-white/70 mb-8 leading-relaxed text-lg">
                  {nowPageCopy.trustSection.description}
                </p>

                <div className="space-y-4 mb-8">
                  {trustPoints.map((item, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                      <span className="text-white/80">{item}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
              
              <motion.div
                className="relative"
                initial={{ opacity: 0, x: 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
              >
                <div className="aspect-[4/3] rounded-3xl overflow-hidden shadow-2xl">
                  <Image
                    src={nowPageCopy.trustSection.imageSrc}
                    alt={nowPageCopy.trustSection.imageAlt}
                    fill
                    className="object-cover"
                  />
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-16 bg-gradient-to-r from-primary via-primary to-blue-600">
          <div className="max-w-4xl mx-auto px-6 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="font-serif text-3xl md:text-4xl font-bold text-white mb-4">
                {nowPageCopy.ctaSection.title}
              </h2>
              <p className="text-white/80 mb-8 max-w-xl mx-auto">
                {nowPageCopy.ctaSection.description}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href={nowPageCopy.ctaSection.primaryCtaHref}>
                  <Button variant="ghost" size="lg" className="w-full sm:w-auto bg-white text-primary hover:bg-slate-100 hover:text-primary rounded-full px-8">
                    {nowPageCopy.ctaSection.primaryCtaLabel}
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
                <a href={nowPageCopy.ctaSection.secondaryCtaHref}>
                  <Button variant="outline" size="lg" className="w-full sm:w-auto border-white text-white hover:bg-white/10 rounded-full px-8">
                    <Phone className="w-4 h-4" />
                    {nowPageCopy.ctaSection.secondaryCtaLabel}
                  </Button>
                </a>
              </div>
            </motion.div>
          </div>
        </section>

        <Footer />
      </div>
    </main>
  );
}
