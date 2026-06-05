"use client";

// T61 mobile-first hero. Replaces the desktop-era split (faint background +
// inline 5-field booking form) with:
//   - a single static hero image (4:5 on mobile, 16:9 on desktop),
//   - badge + H1 + sub-headline (all CMS-driven via useCmsSection),
//   - a primary "Book a Visit" CTA wired to the shared gate→modal flow,
//   - a secondary "Talk to us on WhatsApp" outline CTA,
//   - a static micro-trust strip (rating + visits + response time),
//   - QuickBookCard as a follow-on card (callback path, 2 fields) below the CTAs.
//
// Locked T61 plan-gate decisions honoured here:
//   - Hero CTAs route to the shared booking flow (useBookingFlow → Navbar's
//     BookingGate/BookingModal). The inline 5-field form + BookingConfirmation
//     conditional are gone (safety-grep confirmed confirmedBooking is produced
//     /consumed centrally by BookingModal + LabTestBasket, not uniquely here).
//   - Hero stats stay STATIC text (AnimatedCounter goes on StatsBar, not here).
//   - QuickBookCard is the callback path only — no onBook prop.
//
// Motion values come from the shared design tokens; everything degrades to a
// static render under prefers-reduced-motion.

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, MessageCircle, Star, Clock, Users } from "lucide-react";

import { useCmsSection } from "@/hooks/useCmsSection";
import { useBookingFlow } from "@/hooks/useBookingFlow";
import { HOME_CONTENT } from "@/constants/cms-content";
import { tokens } from "@/lib/design/tokens";
import { QuickBookCard } from "@/components/marketing/QuickBookCard";

const HERO_IMAGE_SRC = "/banner/optimized/1-experienced-team.jpg";
const WHATSAPP_HREF = `https://wa.me/919711977782?text=${encodeURIComponent(
  "Hi, I'd like to book a Sanocare visit",
)}`;

export function Hero() {
  const { data: heroCopy } = useCmsSection("home", "hero", HOME_CONTENT.hero);
  const { requestBooking } = useBookingFlow();
  const prefersReducedMotion = useReducedMotion();

  // Shared entrance: fade + small slide-up, eased on the token curve. Disabled
  // under reduced motion (initial === animate so nothing moves).
  const reveal = (delay = 0) =>
    prefersReducedMotion
      ? {}
      : {
          initial: { opacity: 0, y: 20 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: tokens.motion.durationSec.reveal,
            ease: tokens.motion.ease.standard,
            delay,
          },
        };

  return (
    <section className="bg-background-light">
      <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-12 pt-4 pb-10 lg:py-14">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center">
          {/* Hero image — first on mobile (visual hook), right on desktop. */}
          <motion.div
            className="order-1 lg:order-2"
            {...reveal(prefersReducedMotion ? 0 : 0.1)}
          >
            <div className="relative w-full overflow-hidden rounded-3xl shadow-xl shadow-slate-900/10 aspect-[4/5] sm:aspect-[16/10] lg:aspect-[4/5]">
              <Image
                src={HERO_IMAGE_SRC}
                alt="Sanocare's experienced doctors and qualified medics"
                fill
                priority
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover"
              />
            </div>
          </motion.div>

          {/* Copy + CTAs. */}
          <div className="order-2 lg:order-1 flex flex-col gap-5">
            {/* Badge */}
            <motion.div
              {...reveal(0)}
              className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-white/70 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-primary shadow-sm"
            >
              <span className="size-2 rounded-full bg-primary animate-pulse" />
              {heroCopy.badgeText}
            </motion.div>

            {/* Heading */}
            <motion.h1
              {...reveal(prefersReducedMotion ? 0 : 0.05)}
              className="font-serif text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.1] tracking-tight text-text-main"
            >
              {heroCopy.headingPrefix}{" "}
              <span className="italic font-light text-transparent bg-clip-text bg-gradient-to-r from-primary via-primary-dark to-primary-700">
                {heroCopy.headingHighlight}
              </span>
            </motion.h1>

            {/* Sub-headline */}
            <motion.p
              {...reveal(prefersReducedMotion ? 0 : 0.1)}
              className="text-base sm:text-lg leading-relaxed text-text-secondary max-w-xl"
            >
              {heroCopy.description}
            </motion.p>

            {/* CTAs */}
            <motion.div
              {...reveal(prefersReducedMotion ? 0 : 0.15)}
              className="flex flex-col sm:flex-row gap-3 pt-1"
            >
              <button
                type="button"
                onClick={requestBooking}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-primary/30 transition-all hover:bg-primary-dark hover:shadow-primary/50 active:scale-[0.97]"
              >
                Book a Visit
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <a
                href={WHATSAPP_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-primary/30 px-6 py-3.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5 active:scale-[0.97]"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                Talk to us on WhatsApp
              </a>
            </motion.div>

            {/* Static micro-trust strip (per locked decision: no count-up here). */}
            <motion.div
              {...reveal(prefersReducedMotion ? 0 : 0.2)}
              className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-2 text-sm text-text-secondary"
            >
              <span className="inline-flex items-center gap-1.5 font-semibold text-text-main">
                <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" aria-hidden="true" />
                4.7
                <span className="font-normal text-text-secondary">(75 reviews)</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-4 w-4 text-primary" aria-hidden="true" />
                1,000+ visits
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
                &lt;30 min response
              </span>
            </motion.div>
          </div>
        </div>

        {/* Quick Book — follow-on callback card below the hero CTAs.
            id="hero-booking-form" aliases the legacy anchor: CMS CTAs across the
            site still link to /#hero-booking-form (the old inline form). Keeping
            the id here means those anchors scroll to the Quick Book card instead
            of dead-ending. scroll-mt clears the sticky top nav. */}
        <motion.div
          id="hero-booking-form"
          {...reveal(prefersReducedMotion ? 0 : 0.1)}
          className="mt-8 lg:mt-12 scroll-mt-24"
        >
          <QuickBookCard />
        </motion.div>
      </div>
    </section>
  );
}
