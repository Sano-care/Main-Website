"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { 
  Shield, 
  Users, 
  Stethoscope,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { Navbar, Footer } from "@/components";
import { useCmsSection } from "@/hooks/useCmsSection";
import { useCmsMedia } from "@/hooks/useCmsMedia";
import { ABOUT_PAGE_CONTENT } from "@/constants/cms-content";

type AboutPageCopy = typeof ABOUT_PAGE_CONTENT.pageCopy;
type AboutCompanyInfo = typeof ABOUT_PAGE_CONTENT.companyInfo;
type AboutPillar = (typeof ABOUT_PAGE_CONTENT.pillars)[number];
type AboutValue = (typeof ABOUT_PAGE_CONTENT.values)[number];
type AboutMilestone = (typeof ABOUT_PAGE_CONTENT.milestones)[number];
type AboutTeamMember = (typeof ABOUT_PAGE_CONTENT.teamMembers)[number];
type AboutAccreditation = (typeof ABOUT_PAGE_CONTENT.accreditations)[number];

function withCompanyName(value: string, companyName: string): string {
  return value.replace("{companyName}", companyName);
}

// ============================================
// COMPONENTS
// ============================================

function HeroSection({
  aboutPageCopy,
  companyInfo,
}: {
  aboutPageCopy: AboutPageCopy;
  companyInfo: AboutCompanyInfo;
}) {
  return (
    <section className="relative pt-20 pb-20 lg:pt-32 lg:pb-32 overflow-hidden">
      {/* Background Elements */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[20%] -right-[10%] w-[60vw] h-[60vw] rounded-full bg-gradient-to-br from-blue-50 to-transparent blur-3xl opacity-60" />
        <div className="absolute -bottom-[20%] -left-[10%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-tr from-indigo-50 to-transparent blur-3xl opacity-60" />
      </div>

      <div className="mx-auto max-w-[1400px] px-6 lg:px-12 relative z-10">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Content */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
            className="flex flex-col gap-8"
          >
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-white/50 backdrop-blur-sm px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-primary shadow-sm">
              <span className="size-2 rounded-full bg-primary animate-pulse" />
              {aboutPageCopy.hero.trustPrefix} {companyInfo.foundingYear}
            </div>

            <h1 className="font-serif text-5xl font-medium leading-[1.1] tracking-tight text-slate-900 sm:text-6xl lg:text-7xl">
              {aboutPageCopy.hero.titlePrefix} <br />
              <span className="text-primary italic">{aboutPageCopy.hero.titleHighlight}</span>
            </h1>

            <p className="text-xl leading-relaxed text-slate-600 max-w-xl font-light">
              {withCompanyName(aboutPageCopy.hero.description, companyInfo.name)}
            </p>

            <div className="pt-4">
              <Link
                href={aboutPageCopy.hero.ctaHref}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-10 py-4 text-sm font-bold text-white shadow-xl shadow-primary/20 hover:bg-primary-dark transition-all transform hover:-translate-y-1"
              >
                {aboutPageCopy.hero.ctaLabel}
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </motion.div>

          {/* Image with Quote Card */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="relative"
          >
            <div className="aspect-[4/5] rounded-[2rem] overflow-hidden shadow-2xl relative z-10 border-8 border-white bg-gradient-to-br from-primary/10 to-primary/5">
              <div className="absolute inset-0 flex items-center justify-center">
                <Stethoscope className="w-32 h-32 text-primary/20" />
              </div>
              {/* Replace with actual image */}
              {/* <Image src="/about/hero.jpg" alt="Medical Excellence" fill className="object-cover" /> */}
            </div>

            {/* Floating Quote Card */}
            <div className="absolute -bottom-10 -left-10 bg-white/70 backdrop-blur-xl p-8 rounded-2xl shadow-xl z-20 max-w-xs border border-white/50">
              <Shield className="w-10 h-10 text-primary mb-4" />
              <p className="text-sm font-medium text-slate-900 italic">
                &quot;{companyInfo.founderQuote}&quot;
              </p>
              <p className="mt-2 text-xs font-bold uppercase text-slate-500">
                {companyInfo.founderName}, {companyInfo.founderTitle}
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function WhoWeAreSection({
  aboutPageCopy,
  companyInfo,
  pillars,
}: {
  aboutPageCopy: AboutPageCopy;
  companyInfo: AboutCompanyInfo;
  pillars: AboutPillar[];
}) {
  return (
    <section className="py-24 lg:py-36 bg-white">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-3xl"
        >
          <span className="text-primary font-bold tracking-widest text-xs uppercase mb-3 block">
            {aboutPageCopy.whoWeAre.badge}
          </span>
          <h2 className="font-serif text-4xl lg:text-5xl font-medium text-slate-900 mb-8">
            {aboutPageCopy.whoWeAre.title}
          </h2>
          <div className="space-y-6 text-lg text-slate-600 font-light leading-relaxed">
            <p>
              {withCompanyName(aboutPageCopy.whoWeAre.paragraphs[0], companyInfo.name)}
            </p>
            <p>
              {aboutPageCopy.whoWeAre.paragraphs[1]}
            </p>
          </div>
        </motion.div>

        {/* Three Pillars */}
        <div className="grid md:grid-cols-3 gap-12 mt-24">
          {pillars.map((pillar, index) => (
            <motion.div
              key={pillar.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="flex flex-col gap-4 p-8 border-l-2 border-slate-200 hover:border-primary transition-colors"
            >
              <span className="text-5xl font-serif text-primary">{pillar.number}</span>
              <h3 className="text-xl font-bold text-slate-900">{pillar.title}</h3>
              <p className="text-slate-600 text-sm leading-relaxed">{pillar.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ValuesSection({
  aboutPageCopy,
  companyInfo,
  values,
}: {
  aboutPageCopy: AboutPageCopy;
  companyInfo: AboutCompanyInfo;
  values: AboutValue[];
}) {
  return (
    <section className="py-28 lg:py-36 relative bg-slate-50">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-20"
        >
          <span className="text-primary font-bold tracking-widest text-xs uppercase mb-3 block">
            {aboutPageCopy.valuesSection.badge}
          </span>
          <h2 className="font-serif text-4xl lg:text-5xl font-medium text-slate-900">
            {aboutPageCopy.valuesSection.titlePrefix} {companyInfo.name}
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-10">
          {values.map((value, index) => {
            const Icon = typeof value.icon === "function" ? value.icon : Shield;
            return (
              <motion.div
                key={value.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="group relative p-10 bg-white rounded-2xl shadow-sm border border-slate-100 hover:shadow-xl transition-all duration-300"
              >
                <div className="size-16 rounded-xl bg-blue-50 text-primary flex items-center justify-center mb-8 group-hover:bg-primary group-hover:text-white transition-colors">
                  <Icon className="w-8 h-8" />
                </div>
                <h3 className="font-serif text-2xl font-bold mb-4 text-slate-900">
                  {value.title}
                </h3>
                <p className="text-slate-600 leading-relaxed">{value.description}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function TeamSection({
  aboutPageCopy,
  teamMembers,
}: {
  aboutPageCopy: AboutPageCopy;
  teamMembers: AboutTeamMember[];
}) {
  const { data: teamMedia } = useCmsMedia("about", "team_members");

  return (
    <section className="py-24 bg-slate-900 text-white overflow-hidden">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
        <div className="flex flex-col md:flex-row justify-between items-end mb-20 gap-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <span className="text-primary font-bold tracking-widest text-xs uppercase mb-3 block">
              {aboutPageCopy.teamSection.badge}
            </span>
            <h2 className="font-serif text-4xl lg:text-5xl font-medium">
              {aboutPageCopy.teamSection.title}
            </h2>
          </motion.div>
          <p className="max-w-md text-white/60 font-light">
            {aboutPageCopy.teamSection.description}
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {teamMembers.map((member, index) => {
            const asset = teamMedia.find((item) => item.itemKey === member.key);
            return (
            <motion.div
              key={member.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="group"
            >
              <div className="aspect-[3/4] rounded-2xl overflow-hidden mb-6 relative bg-gradient-to-br from-slate-700 to-slate-800">
                {asset?.publicUrl ? (
                  <Image
                    src={asset.publicUrl}
                    alt={asset.altText ?? member.name}
                    fill
                    className="object-cover grayscale group-hover:grayscale-0 transition-all duration-500"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Users className="w-16 h-16 text-slate-600" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <h4 className="text-xl font-serif font-bold">{member.name}</h4>
              <p className="text-primary text-sm uppercase font-bold tracking-wider mt-1">
                {member.role}
              </p>
            </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function TimelineSection({
  aboutPageCopy,
  companyInfo,
  milestones,
}: {
  aboutPageCopy: AboutPageCopy;
  companyInfo: AboutCompanyInfo;
  milestones: AboutMilestone[];
}) {
  return (
    <section className="py-28 lg:py-36 relative bg-white">
      <div className="mx-auto max-w-[1200px] px-6 lg:px-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-24"
        >
          <span className="text-primary font-bold tracking-widest text-xs uppercase mb-3 block">
            {aboutPageCopy.timelineSection.badge}
          </span>
          <h2 className="font-serif text-4xl lg:text-5xl font-medium text-slate-900">
            {aboutPageCopy.timelineSection.titlePrefix} {companyInfo.name} {aboutPageCopy.timelineSection.titleSuffix}
          </h2>
          <p className="mt-4 text-slate-600 max-w-2xl mx-auto text-lg font-light">
            {aboutPageCopy.timelineSection.description}
          </p>
        </motion.div>

        <div className="relative">
          {/* Timeline Line */}
          <div className="absolute left-4 lg:left-1/2 top-0 bottom-0 w-0.5 bg-slate-200 lg:-translate-x-1/2" />

          <div className="space-y-24 lg:space-y-32">
            {milestones.map((milestone, index) => (
              <motion.div
                key={milestone.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className={`relative flex flex-col lg:flex-row lg:items-center gap-8 lg:gap-16 ${
                  milestone.position === "left" ? "lg:flex-row-reverse" : ""
                }`}
              >
                {/* Content */}
                <div className={`lg:w-1/2 pl-12 lg:pl-0 ${
                  milestone.position === "right" ? "lg:text-right" : "lg:text-left"
                }`}>
                  <span className="text-primary font-bold text-xl mb-2 block">
                    {milestone.year}
                  </span>
                  <h3 className="font-serif text-2xl font-bold text-slate-900">
                    {milestone.title}
                  </h3>
                  <p className="mt-2 text-slate-600 text-lg">
                    {milestone.description}
                  </p>
                </div>

                {/* Timeline Dot */}
                <div className="absolute left-0 lg:left-1/2 lg:-translate-x-1/2 top-0 lg:top-1/2 lg:-translate-y-1/2 z-10">
                  <div className={`size-12 rounded-full border-4 shadow-lg flex items-center justify-center text-base font-bold ${
                    index === 0 
                      ? "bg-primary border-white text-white" 
                      : "bg-white border-slate-200 text-slate-900"
                  }`}>
                    {index + 1}
                  </div>
                </div>

                {/* Image Placeholder */}
                <div className="lg:w-1/2 pl-12 lg:pl-0">
                  <div className="relative h-64 w-full rounded-2xl bg-gradient-to-br from-slate-100 to-slate-50 shadow-md overflow-hidden flex items-center justify-center">
                    <Sparkles className="w-12 h-12 text-slate-300" />
                    {/* Replace with actual image */}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AccreditationsSection({
  aboutPageCopy,
  accreditations,
}: {
  aboutPageCopy: AboutPageCopy;
  accreditations: AboutAccreditation[];
}) {
  return (
    <section className="border-t border-slate-200 bg-white/50 py-16">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
        <p className="mb-10 text-center text-xs font-bold uppercase tracking-widest text-slate-500">
          {aboutPageCopy.accreditationsLabel}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-12 opacity-50 grayscale transition-opacity hover:opacity-100 lg:gap-24">
          {accreditations.map((acc) => {
            const Icon = typeof acc.icon === "function" ? acc.icon : Shield;
            return (
              <div key={acc.name} className="flex items-center gap-2 group">
                <Icon className="w-10 h-10 group-hover:text-primary transition-colors" />
                <span className="font-bold text-xl font-serif">{acc.name}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CTASection({ aboutPageCopy }: { aboutPageCopy: AboutPageCopy }) {
  return (
    <section className="py-20 lg:py-28 bg-gradient-to-br from-primary to-primary-dark">
      <div className="max-w-4xl mx-auto px-6 lg:px-12 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <h2 className="text-3xl lg:text-4xl font-serif font-bold text-white mb-4">
            {aboutPageCopy.ctaSection.title}
          </h2>
          <p className="text-white/80 max-w-2xl mx-auto mb-8 text-lg">
            {aboutPageCopy.ctaSection.description}
          </p>
          <Link
            href={aboutPageCopy.ctaSection.ctaHref}
            className="inline-flex items-center gap-2 px-10 py-4 bg-white text-primary font-bold rounded-full hover:shadow-lg transition-all transform hover:-translate-y-1"
          >
            {aboutPageCopy.ctaSection.ctaLabel}
            <ArrowRight className="w-5 h-5" />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}

// ============================================
// MAIN PAGE
// ============================================

export default function AboutPage() {
  const { data: aboutPageCopy } = useCmsSection(
    "about",
    "page_copy",
    ABOUT_PAGE_CONTENT.pageCopy,
  );
  const { data: companyInfo } = useCmsSection(
    "about",
    "company_info",
    ABOUT_PAGE_CONTENT.companyInfo,
  );
  const { data: pillars } = useCmsSection(
    "about",
    "pillars",
    ABOUT_PAGE_CONTENT.pillars,
  );
  const { data: valuesData } = useCmsSection(
    "about",
    "values",
    ABOUT_PAGE_CONTENT.values,
  );
  const { data: milestones } = useCmsSection(
    "about",
    "milestones",
    ABOUT_PAGE_CONTENT.milestones,
  );
  const { data: teamMembers } = useCmsSection(
    "about",
    "team_members",
    ABOUT_PAGE_CONTENT.teamMembers,
  );
  const { data: accreditationsData } = useCmsSection(
    "about",
    "accreditations",
    ABOUT_PAGE_CONTENT.accreditations,
  );

  const values = valuesData.map((value, index) => ({
    ...value,
    icon: value.icon ?? ABOUT_PAGE_CONTENT.values[index]?.icon ?? Shield,
  }));
  const accreditations = accreditationsData.map((accreditation, index) => ({
    ...accreditation,
    icon: accreditation.icon ?? ABOUT_PAGE_CONTENT.accreditations[index]?.icon ?? Shield,
  }));

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      
      <main>
        <HeroSection aboutPageCopy={aboutPageCopy} companyInfo={companyInfo} />
        <WhoWeAreSection aboutPageCopy={aboutPageCopy} companyInfo={companyInfo} pillars={pillars} />
        <ValuesSection aboutPageCopy={aboutPageCopy} companyInfo={companyInfo} values={values} />
        <TeamSection aboutPageCopy={aboutPageCopy} teamMembers={teamMembers} />
        <TimelineSection aboutPageCopy={aboutPageCopy} companyInfo={companyInfo} milestones={milestones} />
        <AccreditationsSection aboutPageCopy={aboutPageCopy} accreditations={accreditations} />
        <CTASection aboutPageCopy={aboutPageCopy} />
      </main>

      <Footer />
    </div>
  );
}
