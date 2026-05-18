"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Smartphone,
} from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button, GlassCard, Input } from "@/components/ui";
import { useCmsSection } from "@/hooks/useCmsSection";
import { SANOPULSE_PAGE_CONTENT } from "@/constants/cms-content";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

export default function SanopulsePage() {
  const { data: hero } = useCmsSection(
    "sanopulse",
    "hero",
    SANOPULSE_PAGE_CONTENT.hero,
  );
  const { data: features } = useCmsSection(
    "sanopulse",
    "features",
    SANOPULSE_PAGE_CONTENT.features,
  );
  const { data: fitsInto } = useCmsSection(
    "sanopulse",
    "fits_into",
    SANOPULSE_PAGE_CONTENT.fitsInto,
  );
  const { data: roadmap } = useCmsSection(
    "sanopulse",
    "roadmap",
    SANOPULSE_PAGE_CONTENT.roadmap,
  );
  const { data: waitlist } = useCmsSection(
    "sanopulse",
    "waitlist",
    SANOPULSE_PAGE_CONTENT.waitlist,
  );
  const { data: faq } = useCmsSection(
    "sanopulse",
    "faq",
    SANOPULSE_PAGE_CONTENT.faq,
  );
  const { data: privacy } = useCmsSection(
    "sanopulse",
    "privacy",
    SANOPULSE_PAGE_CONTENT.privacy,
  );
  const { data: ctaBand } = useCmsSection(
    "sanopulse",
    "cta_band",
    SANOPULSE_PAGE_CONTENT.ctaBand,
  );

  const [submitStatus, setSubmitStatus] = useState<
    { type: "success" | "error"; message: string } | null
  >(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const featureItems = features.items.map((item, index) => ({
    ...item,
    icon: item.icon ?? SANOPULSE_PAGE_CONTENT.features.items[index]?.icon,
  }));
  const privacyItems = privacy.items.map((item, index) => ({
    ...item,
    icon: item.icon ?? SANOPULSE_PAGE_CONTENT.privacy.items[index]?.icon,
  }));

  // Submit handler — uses Netlify Forms via HTML form-name field.
  // Falls back to a plain POST so it works even when Netlify dashboard hasn't been configured yet.
  const handleWaitlistSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitStatus(null);
    setIsSubmitting(true);
    try {
      const form = e.currentTarget;
      const formData = new FormData(form);
      // Netlify expects URL-encoded body when posting from JS.
      const body = new URLSearchParams(formData as unknown as Record<string, string>);
      const response = await fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!response.ok) throw new Error("Network error");
      form.reset();
      setSubmitStatus({ type: "success", message: waitlist.successMessage });
    } catch {
      setSubmitStatus({ type: "error", message: waitlist.errorMessage });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-background-light">
      <Navbar />

      {/* ===== Hero ===== */}
      <section className="relative overflow-hidden pt-12 pb-16 lg:pt-20 lg:pb-24">
        {/* Subtle brand-tint backdrop */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-0 right-0 w-[680px] h-[680px] rounded-full bg-primary/10 blur-3xl opacity-50" />
          <div className="absolute bottom-0 left-0 w-[440px] h-[440px] rounded-full bg-accent-coral/10 blur-3xl opacity-50" />
        </div>

        <div className="mx-auto max-w-[1280px] px-6 lg:px-12">
          <motion.div
            className="grid md:grid-cols-12 gap-10 items-center"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            <div className="md:col-span-7 flex flex-col gap-5">
              <motion.div variants={itemVariants}>
                <span className="inline-flex items-center gap-2 bg-primary/10 text-primary-dark px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider border border-primary/20">
                  <span className="sano-pulse-dot" /> {hero.eyebrowText}
                </span>
              </motion.div>

              <motion.h1
                variants={itemVariants}
                className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tight text-text-main"
              >
                {hero.titlePrefix}
                <br />
                <span className="text-primary">{hero.titleHighlight}</span>
              </motion.h1>

              <motion.p
                variants={itemVariants}
                className="text-lg leading-relaxed text-text-secondary max-w-2xl"
              >
                {hero.description}
              </motion.p>

              <motion.div
                variants={itemVariants}
                className="flex flex-wrap items-center gap-3 pt-2"
              >
                <Link href={hero.primaryCtaHref}>
                  <Button variant="primary" size="lg" glow>
                    {hero.primaryCtaLabel}
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
                <Link href={hero.secondaryCtaHref}>
                  <Button variant="outline" size="lg">
                    {hero.secondaryCtaLabel}
                  </Button>
                </Link>
              </motion.div>

              <motion.ul
                variants={itemVariants}
                className="flex flex-wrap gap-x-5 gap-y-2 pt-4 text-sm text-text-secondary"
              >
                {hero.trustBullets.map((b: string) => (
                  <li key={b} className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-primary" />
                    {b}
                  </li>
                ))}
              </motion.ul>
            </div>

            {/* Phone mockup placeholder — replace with real screenshot when Pulse UI is built */}
            <motion.div
              className="md:col-span-5 flex justify-center md:justify-end"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <div className="relative w-[280px] h-[560px] rounded-[40px] border-8 border-text-main bg-white shadow-2xl overflow-hidden">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-text-main rounded-b-2xl z-10" />
                <div className="flex flex-col items-center justify-center h-full px-6 text-center bg-gradient-to-br from-primary-50 via-white to-accent-coral-50">
                  <Image
                    src="/logo.svg"
                    alt="Sanocare mark"
                    width={72}
                    height={72}
                    className="w-18 h-18 mb-4"
                  />
                  <div className="text-text-main text-xl font-bold mb-2">
                    Sanocare Pulse
                  </div>
                  <div className="text-text-secondary text-sm mb-6">
                    Coming to your phone
                  </div>
                  <div className="flex items-center gap-2 text-xs text-primary-dark bg-primary/10 px-3 py-1.5 rounded-full">
                    <Smartphone className="w-3 h-3" />
                    Android · Closed beta
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ===== Features ===== */}
      <section id="features" className="py-16 lg:py-24 bg-white">
        <div className="mx-auto max-w-[1280px] px-6 lg:px-12">
          <div className="max-w-2xl mb-12">
            <span className="text-xs font-mono uppercase tracking-widest text-primary-dark">
              {features.badge}
            </span>
            <h2 className="mt-3 text-3xl lg:text-4xl font-bold text-text-main">
              {features.title}
            </h2>
            <p className="mt-3 text-text-secondary text-lg">
              {features.description}
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {featureItems.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="rounded-2xl border border-slate-200 bg-white p-6 hover:border-primary/30 hover:shadow-lg transition-all"
                >
                  <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                    {Icon ? <Icon className="w-5 h-5 text-primary" /> : null}
                  </div>
                  <h3 className="text-lg font-bold text-text-main mb-1">
                    {f.title}
                  </h3>
                  <p className="text-text-secondary text-sm leading-relaxed">
                    {f.description}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Fits-into band */}
          <div className="mt-16 rounded-3xl bg-gradient-to-br from-primary-50 to-white border border-primary/15 p-8 lg:p-12">
            <h3 className="text-2xl lg:text-3xl font-bold text-text-main mb-3">
              {fitsInto.title}
            </h3>
            <p className="text-text-secondary text-lg max-w-3xl">
              {fitsInto.description}
            </p>
          </div>
        </div>
      </section>

      {/* ===== Roadmap ===== */}
      <section className="py-16 lg:py-24">
        <div className="mx-auto max-w-[1280px] px-6 lg:px-12">
          <div className="max-w-2xl mb-12">
            <span className="text-xs font-mono uppercase tracking-widest text-primary-dark">
              {roadmap.badge}
            </span>
            <h2 className="mt-3 text-3xl lg:text-4xl font-bold text-text-main">
              {roadmap.title}
            </h2>
            <p className="mt-3 text-text-secondary text-lg">
              {roadmap.description}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {roadmap.phases.map((phase) => (
              <div
                key={phase.phase}
                className={`rounded-2xl border p-6 ${
                  phase.status === "in_development"
                    ? "border-primary bg-primary/5"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold text-text-main">
                    {phase.phase}
                  </span>
                  <span
                    className={`text-xs font-semibold px-2 py-1 rounded-full ${
                      phase.status === "in_development"
                        ? "bg-primary text-white"
                        : phase.status === "planned"
                          ? "bg-slate-100 text-text-secondary"
                          : "bg-slate-50 text-text-secondary"
                    }`}
                  >
                    {phase.statusLabel}
                  </span>
                </div>
                <ul className="space-y-2 text-sm text-text-secondary">
                  {phase.items.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Waitlist form ===== */}
      <section id="waitlist" className="py-16 lg:py-24 bg-gradient-to-b from-white to-slate-50">
        <div className="mx-auto max-w-[760px] px-6 lg:px-12">
          <div className="text-center mb-10">
            <span className="text-xs font-mono uppercase tracking-widest text-primary-dark">
              {waitlist.badge}
            </span>
            <h2 className="mt-3 text-3xl lg:text-4xl font-bold text-text-main">
              {waitlist.title}
            </h2>
            <p className="mt-3 text-text-secondary text-lg">
              {waitlist.description}
            </p>
          </div>

          <GlassCard variant="solid" className="p-6 lg:p-8">
            {submitStatus?.type === "success" ? (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-green-50 border border-green-200 text-green-900">
                <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <span>{submitStatus.message}</span>
              </div>
            ) : (
              <form
                name={waitlist.formName}
                method="POST"
                data-netlify="true"
                netlify-honeypot={waitlist.spamFieldName}
                onSubmit={handleWaitlistSubmit}
                className="space-y-4"
              >
                {/* Required for Netlify Forms detection */}
                <input type="hidden" name="form-name" value={waitlist.formName} />
                <p className="hidden">
                  <label>
                    Don&apos;t fill this out if you&apos;re human:{" "}
                    <input name={waitlist.spamFieldName} />
                  </label>
                </p>

                <div className="grid sm:grid-cols-2 gap-4">
                  <Input
                    label={waitlist.fields.nameLabel}
                    name="name"
                    placeholder={waitlist.fields.namePlaceholder}
                    required
                  />
                  <Input
                    label={waitlist.fields.phoneLabel}
                    name="phone"
                    type="tel"
                    placeholder={waitlist.fields.phonePlaceholder}
                    required
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Input
                    label={waitlist.fields.emailLabel}
                    name="email"
                    type="email"
                    placeholder={waitlist.fields.emailPlaceholder}
                    required
                  />
                  <Input
                    label={waitlist.fields.pincodeLabel}
                    name="pincode"
                    placeholder={waitlist.fields.pincodePlaceholder}
                    pattern="[0-9]{6}"
                    inputMode="numeric"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-text-main mb-1.5">
                    {waitlist.fields.reasonLabel}
                  </label>
                  <textarea
                    name="reason"
                    rows={3}
                    placeholder={waitlist.fields.reasonPlaceholder}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    name="dpdp-consent"
                    required
                    className="mt-1 w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-text-secondary leading-relaxed">
                    {waitlist.fields.consentLabel}
                  </span>
                </label>

                {submitStatus?.type === "error" && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 text-red-700 text-sm">
                    <AlertCircle className="w-4 h-4" />
                    {submitStatus.message}
                  </div>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  glow
                  className="w-full"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {waitlist.submittingLabel}
                    </>
                  ) : (
                    <>
                      {waitlist.submitLabel}
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </Button>
              </form>
            )}
          </GlassCard>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section className="py-16 lg:py-24 bg-white">
        <div className="mx-auto max-w-[860px] px-6 lg:px-12">
          <div className="mb-10">
            <span className="text-xs font-mono uppercase tracking-widest text-primary-dark">
              {faq.badge}
            </span>
            <h2 className="mt-3 text-3xl lg:text-4xl font-bold text-text-main">
              {faq.title}
            </h2>
          </div>
          <div className="space-y-3">
            {faq.items.map((item) => (
              <details
                key={item.question}
                className="group rounded-2xl border border-slate-200 bg-white overflow-hidden"
              >
                <summary className="flex items-center justify-between px-6 py-4 cursor-pointer list-none font-semibold text-text-main hover:bg-slate-50">
                  <span>{item.question}</span>
                  <span className="text-primary text-2xl leading-none transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <div className="px-6 pb-5 text-text-secondary leading-relaxed">
                  {item.answer}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Privacy / DPDP ===== */}
      <section className="py-16 lg:py-24 bg-slate-50">
        <div className="mx-auto max-w-[1280px] px-6 lg:px-12">
          <div className="max-w-2xl mb-10">
            <span className="text-xs font-mono uppercase tracking-widest text-primary-dark">
              {privacy.badge}
            </span>
            <h2 className="mt-3 text-3xl lg:text-4xl font-bold text-text-main">
              {privacy.title}
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {privacyItems.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="rounded-2xl bg-white border border-slate-200 p-5"
                >
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                    {Icon ? <Icon className="w-4 h-4 text-primary" /> : null}
                  </div>
                  <h3 className="font-bold text-text-main mb-1">{item.title}</h3>
                  <p className="text-sm text-text-secondary leading-relaxed">
                    {item.description}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="mt-8 text-sm text-text-secondary">
            {privacy.grievanceLine}
          </p>
        </div>
      </section>

      {/* ===== Final CTA ===== */}
      <section className="py-16 lg:py-20">
        <div className="mx-auto max-w-[1280px] px-6 lg:px-12">
          <div className="rounded-3xl bg-gradient-to-br from-primary to-primary-dark p-8 lg:p-14 text-white">
            <div className="grid md:grid-cols-12 gap-6 items-center">
              <div className="md:col-span-8">
                <h3 className="text-2xl lg:text-3xl font-bold mb-2">
                  {ctaBand.title}
                </h3>
                <p className="text-white/85">{ctaBand.description}</p>
              </div>
              <div className="md:col-span-4 flex flex-wrap gap-3 md:justify-end">
                <Link href={ctaBand.primaryCtaHref}>
                  <Button variant="outline" size="lg" className="bg-white text-primary border-white hover:bg-white/90">
                    {ctaBand.primaryCtaLabel}
                  </Button>
                </Link>
                <Link href={ctaBand.secondaryCtaHref}>
                  <Button variant="outline" size="lg" className="border-white/30 text-white hover:bg-white/10">
                    {ctaBand.secondaryCtaLabel}
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
