"use client";

import { motion } from "framer-motion";
import { Home, Search } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui";
import { useCmsSection } from "@/hooks/useCmsSection";
import { NOT_FOUND_PAGE_CONTENT } from "@/constants/cms-content";

export default function NotFound() {
  const { data: notFoundCopy } = useCmsSection(
    "not-found",
    "page_copy",
    NOT_FOUND_PAGE_CONTENT,
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex flex-col">
      {/* Simple Header */}
      <header className="border-b border-slate-100 bg-white/80 backdrop-blur-sm">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-12 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <Image
              src="/logo.svg"
              alt={notFoundCopy.logoAlt}
              width={40}
              height={40}
              className="w-10 h-10"
            />
            <h2 className="text-2xl font-serif font-bold tracking-tight text-text-main">
              {notFoundCopy.brandWordmarkPrefix}<span className="text-primary font-normal italic">{notFoundCopy.brandWordmarkHighlight}</span>
            </h2>
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
          {/* 404 Visual */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", delay: 0.2, stiffness: 200 }}
            className="relative mx-auto mb-8"
          >
            {/* Large 404 */}
            <div className="text-[120px] lg:text-[160px] font-serif font-bold text-slate-100 leading-none select-none">
              {notFoundCopy.pageCode}
            </div>
            {/* Heartbeat overlay */}
            {/* <motion.div 
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
              animate={{ 
                scale: [1, 1.1, 1],
              }}
              transition={{ 
                duration: 1.5, 
                repeat: Infinity,
                ease: "easeInOut"
              }}
            >
              <HeartPulse className="w-16 h-16 text-primary" />
            </motion.div> */}
          </motion.div>

          {/* Heading */}
          <h1 className="text-3xl lg:text-4xl font-serif font-bold text-text-main mb-4">
            {notFoundCopy.title}
          </h1>

          {/* Description */}
          <p className="text-text-secondary mb-8 leading-relaxed">
            {notFoundCopy.description}
          </p>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href={notFoundCopy.actions.primaryHref}>
              <Button variant="primary" size="lg" className="rounded-full w-full sm:w-auto">
                <Home className="w-4 h-4" />
                {notFoundCopy.actions.primaryLabel}
              </Button>
            </Link>
            <Link href={notFoundCopy.actions.secondaryHref}>
              <Button variant="outline" size="lg" className="rounded-full w-full sm:w-auto">
                <Search className="w-4 h-4" />
                {notFoundCopy.actions.secondaryLabel}
              </Button>
            </Link>
          </div>

          {/* Quick Links */}
          <div className="mt-12 pt-8 border-t border-slate-100">
            <p className="text-sm text-text-secondary mb-4">{notFoundCopy.quickLinksLabel}</p>
            <div className="flex flex-wrap justify-center gap-4 text-sm">
              {notFoundCopy.quickLinks.map((item, index) => (
                <div key={item.href} className="flex items-center gap-4">
                  <Link href={item.href} className="text-primary hover:underline">
                    {item.label}
                  </Link>
                  {index < notFoundCopy.quickLinks.length - 1 && <span className="text-slate-300">•</span>}
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </main>

      {/* Footer note */}
      <footer className="py-6 text-center text-sm text-text-secondary border-t border-slate-100">
        {notFoundCopy.helpLabel}{" "}
        <a href={notFoundCopy.helpPhoneHref} className="text-primary hover:underline">
          {notFoundCopy.helpPhone}
        </a>
      </footer>
    </div>
  );
}
