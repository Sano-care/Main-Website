"use client";

import { motion } from "framer-motion";
import { 
  ArrowRight,
  Zap,
  Phone,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui";
import { useCmsSection } from "@/hooks/useCmsSection";
import { SERVICES_PAGE_CONTENT } from "@/constants/cms-content";

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

export default function ServicesPage() {
  const { data: servicesPageCopy } = useCmsSection(
    "services",
    "page_copy",
    SERVICES_PAGE_CONTENT.pageCopy,
  );
  const { data: medicalServicesData } = useCmsSection(
    "services",
    "medical_services",
    SERVICES_PAGE_CONTENT.medicalServices,
  );
  const { data: advantagePoints } = useCmsSection(
    "services",
    "advantage_points",
    SERVICES_PAGE_CONTENT.advantagePoints,
  );
  const { data: signatureProgramsData } = useCmsSection(
    "services",
    "signature_programs",
    SERVICES_PAGE_CONTENT.signaturePrograms,
  );
  const { data: trustBadgesData } = useCmsSection(
    "services",
    "trust_badges",
    SERVICES_PAGE_CONTENT.trustBadges,
  );

  const medicalServices = medicalServicesData.map((service, index) => ({
    ...service,
    icon: service.icon ?? SERVICES_PAGE_CONTENT.medicalServices[index]?.icon ?? Zap,
  }));
  const signaturePrograms = signatureProgramsData.map((program, index) => ({
    ...program,
    icon: program.icon ?? SERVICES_PAGE_CONTENT.signaturePrograms[index]?.icon ?? Zap,
  }));
  const trustBadges = trustBadgesData.map((badge, index) => ({
    ...badge,
    icon: badge.icon ?? SERVICES_PAGE_CONTENT.trustBadges[index]?.icon ?? Zap,
  }));

  return (
    <main className="min-h-screen bg-background-light relative overflow-x-hidden">
      {/* Background Decorations */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[20%] -right-[10%] w-[60vw] h-[60vw] rounded-full bg-gradient-to-br from-blue-50 to-transparent blur-3xl opacity-60" />
        <div className="absolute -bottom-[20%] -left-[10%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-tr from-indigo-50 to-transparent blur-3xl opacity-60" />
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
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-white/50 backdrop-blur-sm px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-primary shadow-sm">
                  <span className="size-2 rounded-full bg-primary animate-pulse" />
                  {servicesPageCopy.hero.badge}
                </div>
                
                <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-medium leading-[1.1] tracking-tight text-text-main">
                  {servicesPageCopy.hero.titlePrefix} <br />
                  <span className="text-primary italic">{servicesPageCopy.hero.titleHighlight}</span>
                </h1>
                
                <p className="text-lg lg:text-xl leading-relaxed text-text-secondary max-w-xl font-light">
                  {servicesPageCopy.hero.description}
                </p>
                
                <div className="flex flex-wrap gap-4 pt-4">
                  <Link href={servicesPageCopy.hero.primaryCtaHref}>
                    <Button className="rounded-full px-8 py-4 shadow-xl shadow-blue-500/20 hover:-translate-y-1 transition-transform">
                      {servicesPageCopy.hero.primaryCtaLabel}
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                  <Link href={servicesPageCopy.hero.secondaryCtaHref}>
                    <Button variant="outline" className="rounded-full px-8 py-4 border-slate-200 hover:border-primary">
                      {servicesPageCopy.hero.secondaryCtaLabel}
                    </Button>
                  </Link>
                </div>
              </motion.div>
              
              {/* Right Image */}
              <motion.div
                className="relative"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                <div className="aspect-[16/10] rounded-[2rem] overflow-hidden shadow-2xl relative z-10 border-8 border-white">
                  <Image
                    src={servicesPageCopy.hero.imageSrc}
                    alt={servicesPageCopy.hero.imageAlt}
                    fill
                    className="object-cover"
                    priority
                  />
                </div>
                
                {/* Floating Card */}
                <motion.div
                  className="absolute -bottom-6 -right-6 bg-white/80 backdrop-blur-xl p-5 rounded-2xl shadow-xl z-20 max-w-[200px] border border-white/50"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <Zap className="w-5 h-5 text-primary" />
                    <span className="text-xs font-bold uppercase tracking-widest">{servicesPageCopy.hero.floatingCardLabel}</span>
                  </div>
                  <p className="text-[11px] text-text-secondary">{servicesPageCopy.hero.floatingCardText}</p>
                </motion.div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Medical Services Grid */}
        <section className="py-20 lg:py-28 bg-white">
          <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
            {/* Section Header */}
            <motion.div
              className="text-center mb-16 max-w-2xl mx-auto"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <span className="text-primary font-bold tracking-widest text-xs uppercase mb-3 block">
                {servicesPageCopy.servicesSection.badge}
              </span>
              <h2 className="font-serif text-3xl lg:text-5xl font-medium text-text-main mb-6">
                {servicesPageCopy.servicesSection.title}
              </h2>
              <p className="text-text-secondary font-light">
                {servicesPageCopy.servicesSection.description}
              </p>
            </motion.div>

            {/* Services Grid */}
            <motion.div
              className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8"
              variants={containerVariants}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
            >
              {medicalServices.map((service) => {
                const Icon = typeof service.icon === "function" ? service.icon : Zap;
                return (
                  <motion.div
                    key={service.id}
                    variants={itemVariants}
                    className="group relative p-8 lg:p-10 bg-white rounded-2xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-100 transition-all duration-300 hover:shadow-2xl hover:-translate-y-2"
                  >
                    <div className="size-14 rounded-xl bg-blue-50 text-primary flex items-center justify-center mb-6 lg:mb-8 transition-all duration-300 group-hover:bg-primary group-hover:text-white group-hover:scale-110">
                      <Icon className="w-7 h-7" />
                    </div>
                    <h3 className="font-serif text-xl lg:text-2xl font-bold mb-3 lg:mb-4 text-text-main">
                      {service.title}
                    </h3>
                    <p className="text-text-secondary leading-relaxed mb-6 lg:mb-8 text-sm">
                      {service.description}
                    </p>
                    <Link
                      href={service.link}
                      className="inline-flex items-center gap-2 text-primary text-sm font-bold uppercase tracking-wider group/link"
                    >
                      {servicesPageCopy.servicesSection.cardCtaLabel}
                      <ArrowRight className="w-4 h-4 transition-transform group-hover/link:translate-x-1" />
                    </Link>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        </section>

        {/* Why Choose Us Section */}
        <section className="py-20 lg:py-28 relative overflow-hidden">
          <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
            <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
              {/* Left Content */}
              <motion.div
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
              >
                <span className="text-primary font-bold tracking-widest text-xs uppercase mb-3 block">
                  {servicesPageCopy.advantageSection.badge}
                </span>
                <h2 className="font-serif text-3xl lg:text-5xl font-medium text-text-main mb-6 lg:mb-8">
                  {servicesPageCopy.advantageSection.title}
                </h2>
                <p className="text-lg text-text-secondary font-light leading-relaxed mb-10 lg:mb-12">
                  {servicesPageCopy.advantageSection.description}
                </p>
                
                <div className="space-y-10 lg:space-y-12">
                  {advantagePoints.map((point, index) => (
                    <motion.div
                      key={point.number}
                      className="flex gap-6 lg:gap-8 group"
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: index * 0.1 }}
                    >
                      <span className="text-4xl lg:text-5xl font-serif text-primary opacity-30 group-hover:opacity-100 transition-opacity duration-300">
                        {point.number}
                      </span>
                      <div>
                        <h3 className="text-lg lg:text-xl font-bold text-text-main mb-2">
                          {point.title}
                        </h3>
                        <p className="text-text-secondary text-sm leading-relaxed max-w-sm">
                          {point.description}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
              
              {/* Right Image */}
              <motion.div
                className="relative"
                initial={{ opacity: 0, x: 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
              >
                <div className="aspect-square rounded-3xl overflow-hidden shadow-2xl relative">
                  <Image
                    src={servicesPageCopy.advantageSection.imageSrc}
                    alt={servicesPageCopy.advantageSection.imageAlt}
                    fill
                    className="object-cover"
                  />
                </div>
                <div className="absolute -top-12 -right-12 size-64 bg-primary/10 rounded-full blur-3xl -z-10" />
              </motion.div>
            </div>
          </div>
        </section>

        {/* Signature Programs - Dark Section */}
        <section className="py-20 lg:py-28 bg-text-main overflow-hidden relative">
          {/* Background Pattern */}
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
            {/* Section Header */}
            <motion.div
              className="text-center mb-16"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <span className="text-primary font-bold tracking-widest text-xs uppercase mb-3 block">
                {servicesPageCopy.programsSection.badge}
              </span>
              <h2 className="font-serif text-3xl lg:text-5xl font-medium text-white">
                {servicesPageCopy.programsSection.title}
              </h2>
            </motion.div>

            {/* Programs Grid */}
            <motion.div
              className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8"
              variants={containerVariants}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
            >
              {signaturePrograms.map((program) => {
                const Icon = typeof program.icon === "function" ? program.icon : Zap;
                return (
                  <motion.div
                    key={program.title}
                    variants={itemVariants}
                    className="group p-8 lg:p-10 rounded-3xl bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 transition-all duration-500"
                  >
                    <div className="text-primary mb-6">
                      <Icon className="w-12 h-12" />
                    </div>
                    <h3 className="text-xl lg:text-2xl font-serif font-bold text-white mb-4">
                      {program.title}
                    </h3>
                    <p className="text-white/60 text-sm leading-relaxed mb-8 font-light">
                      {program.description}
                    </p>
                    <Link
                      href={program.link}
                      className="inline-flex px-6 py-2 rounded-full border border-white/20 text-white text-xs font-bold uppercase tracking-wider group-hover:bg-white group-hover:text-text-main transition-all"
                    >
                      {servicesPageCopy.programsSection.cardCtaLabel}
                    </Link>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        </section>

        {/* Trust Section */}
        <section className="border-t border-slate-200 bg-white/50 py-16">
          <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
            <motion.p
              className="mb-10 text-center text-xs font-bold uppercase tracking-widest text-text-secondary/70"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
            >
              {servicesPageCopy.trustSectionLabel}
            </motion.p>
            <motion.div
              className="flex flex-wrap items-center justify-center gap-8 lg:gap-16"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              {trustBadges.map((item, index) => {
                const Icon = typeof item.icon === "function" ? item.icon : Zap;
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
                    <span className="text-xs text-text-secondary text-center">{item.desc}</span>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-16 bg-gradient-to-r from-primary via-primary-dark to-primary">
          <div className="max-w-4xl mx-auto px-6 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="font-serif text-3xl md:text-4xl font-bold text-white mb-4">
                {servicesPageCopy.ctaSection.title}
              </h2>
              <p className="text-white/80 mb-8 max-w-xl mx-auto">
                {servicesPageCopy.ctaSection.description}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href={servicesPageCopy.ctaSection.primaryCtaHref}>
                  <Button variant="ghost" size="lg" className="w-full sm:w-auto bg-white text-primary hover:bg-slate-100 hover:text-primary rounded-full px-8">
                    {servicesPageCopy.ctaSection.primaryCtaLabel}
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
                <a href={servicesPageCopy.ctaSection.secondaryCtaHref}>
                  <Button variant="outline" size="lg" className="w-full sm:w-auto border-white text-white hover:bg-white/10 rounded-full px-8">
                    <Phone className="w-4 h-4" />
                    {servicesPageCopy.ctaSection.secondaryCtaLabel}
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
