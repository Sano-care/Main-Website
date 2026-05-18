"use client";

import { motion } from "framer-motion";
import { Construction, Bell, ArrowLeft } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui";
import { useCmsSection } from "@/hooks/useCmsSection";
import { PORTAL_PAGE_CONTENT } from "@/constants/cms-content";

export default function PatientPortalPage() {
  const { data: portalCopy } = useCmsSection(
    "portal",
    "page_copy",
    PORTAL_PAGE_CONTENT,
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex flex-col">
      {/* Simple Header */}
      <header className="border-b border-slate-100 bg-white/80 backdrop-blur-sm">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-12 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <Image
              src="/logo.svg"
              alt={portalCopy.logoAlt}
              width={40}
              height={40}
              className="w-10 h-10"
            />
            <h2 className="text-2xl font-serif font-bold tracking-tight text-text-main">
              {portalCopy.brandWordmarkPrefix}<span className="text-primary font-normal italic">{portalCopy.brandWordmarkHighlight}</span>
            </h2>
          </Link>
          <Link href="/">
            <Button variant="outline" size="sm" className="rounded-full">
              <ArrowLeft className="w-4 h-4" />
              {portalCopy.backToHomeLabel}
            </Button>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <motion.div 
          className="max-w-lg text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Icon */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", delay: 0.2, stiffness: 200 }}
            className="mx-auto w-24 h-24 bg-amber-100 rounded-full flex items-center justify-center mb-8"
          >
            <Construction className="w-12 h-12 text-amber-600" />
          </motion.div>

          {/* Badge */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-medium mb-6"
          >
            <span className="size-2 rounded-full bg-primary animate-pulse" />
            {portalCopy.badgeLabel}
          </motion.div>

          {/* Heading */}
          <h1 className="text-3xl lg:text-4xl font-serif font-bold text-text-main mb-4">
            {portalCopy.titlePrefix} <br />
            <span className="text-primary italic font-light">{portalCopy.titleHighlight}</span>
          </h1>

          {/* Description */}
          <p className="text-text-secondary mb-8 leading-relaxed">
            {portalCopy.description}
          </p>

          {/* Features Preview */}
          <div className="bg-slate-50 rounded-2xl p-6 mb-8 text-left">
            <h3 className="text-sm font-bold text-text-main mb-4">{portalCopy.featureTitle}</h3>
            <ul className="space-y-3 text-sm text-text-secondary">
              <li className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-green-600 text-xs">✓</span>
                </div>
                {portalCopy.features[0]}
              </li>
              <li className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-green-600 text-xs">✓</span>
                </div>
                {portalCopy.features[1]}
              </li>
              <li className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-green-600 text-xs">✓</span>
                </div>
                {portalCopy.features[2]}
              </li>
              <li className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-green-600 text-xs">✓</span>
                </div>
                {portalCopy.features[3]}
              </li>
            </ul>
          </div>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href={portalCopy.primaryCta.href}>
              <Button variant="primary" size="lg" className="rounded-full w-full sm:w-auto">
                <Bell className="w-4 h-4" />
                {portalCopy.primaryCta.label}
              </Button>
            </Link>
            <Link href={portalCopy.secondaryCta.href}>
              <Button variant="outline" size="lg" className="rounded-full w-full sm:w-auto">
                {portalCopy.secondaryCta.label}
              </Button>
            </Link>
          </div>
        </motion.div>
      </main>

      {/* Help strip for existing patients */}
      <footer className="border-t border-slate-100 py-6 px-6">
        <div className="max-w-2xl mx-auto text-center text-xs text-text-secondary space-y-2">
          <p className="font-medium text-text-main">{portalCopy.helpStrip.label}</p>
          <p>
            <a href={portalCopy.helpStrip.phoneHref} className="text-primary hover:underline">
              {portalCopy.helpStrip.phoneLabel}
            </a>
            {" · "}
            <a href={portalCopy.helpStrip.emailHref} className="text-primary hover:underline">
              {portalCopy.helpStrip.emailLabel}
            </a>
          </p>
          <p>{portalCopy.helpStrip.note}</p>
        </div>
      </footer>
    </div>
  );
}
