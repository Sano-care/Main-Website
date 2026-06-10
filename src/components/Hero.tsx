"use client";

// T85 PR2 — Hero is informational only.
//
// PR2 stripped the "Book a Visit" + "Talk to us on WhatsApp" CTAs and
// the trailing QuickBookCard mount. Per brief, the only homepage
// booking entry points are the 4 coral CTAs inside ServiceSections,
// the HomeStickyBar, the FloatingWhatsApp pill, and the Navbar button.
//
// What stays:
//   - single static hero image (4:5 on mobile, 16:9 on desktop),
//   - badge + H1 + sub-headline (CMS-driven via useCmsSection),
//   - the static micro-trust strip (rating + visits + response time).
//
// Removed in PR2:
//   - CTA block (Book a Visit + WhatsApp button)
//   - QuickBookCard mount and the `id="hero-booking-form"` anchor
//     wrapper. **PR5 prep note**: three CMS-side surfaces still link to
//     `#hero-booking-form` — `src/constants/cms/legal.ts`,
//     `src/constants/cms/pages.ts`, `src/constants/cms/home.ts`. PR5
//     audits + updates those anchor targets. The anchor is dead in the
//     interim; landing on it scrolls to top of hero (acceptable degrade
//     for CMS legacy links).
//
// Motion values still come from the shared design tokens; everything
// degrades to a static render under prefers-reduced-motion.

import { motion, useReducedMotion } from "framer-motion";
import { Star, Clock, ShieldCheck } from "lucide-react";

import { useCmsSection } from "@/hooks/useCmsSection";
import { HOME_CONTENT } from "@/constants/cms-content";
import { tokens } from "@/lib/design/tokens";
import { HeroCarousel } from "./HeroCarousel";

// 2026-06-09: replaced single static image (HERO_IMAGE_SRC at
// /banner/optimized/1-experienced-team.jpg) with HeroCarousel (3
// brand-aligned slides). Per founder Option B: H1 + sub-headline stay
// above the carousel so the brand promise persists regardless of
// which slide is showing. Trust strip stays below. Layout collapsed
// from 2-col grid (image-right on desktop) to single column on all
// viewports so the "above the carousel" ordering reads correctly.

export function Hero() {
  const { data: heroCopy } = useCmsSection("home", "hero", HOME_CONTENT.hero);
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
      <div className="mx-auto w-full max-w-[900px] px-4 sm:px-6 lg:px-8 pt-4 pb-10 lg:py-14">
        <div className="flex flex-col gap-5">
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
            className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold leading-[1.1] tracking-tight text-text-main"
          >
            {heroCopy.headingPrefix}{" "}
            <span className="italic font-light text-transparent bg-clip-text bg-gradient-to-r from-primary via-primary-dark to-primary-700">
              {heroCopy.headingHighlight}
            </span>
          </motion.h1>

          {/* Sub-headline */}
          <motion.p
            {...reveal(prefersReducedMotion ? 0 : 0.1)}
            className="text-base sm:text-lg leading-relaxed text-text-secondary max-w-2xl"
          >
            {heroCopy.description}
          </motion.p>

          {/* Hero carousel — 3 brand-aligned slides, replaces the static
              hero image. 2.4:1 aspect keeps the total Hero (badge + H1 +
              sub + carousel + trust strip) above-the-fold on 375px
              mobile viewports. */}
          <motion.div {...reveal(prefersReducedMotion ? 0 : 0.15)}>
            <HeroCarousel />
          </motion.div>

          {/* T85 PR2 — CTAs removed. Hero is informational only.
              Booking entry points: 4 coral CTAs inside ServiceSections,
              HomeStickyBar, FloatingWhatsApp pill, Navbar button. */}

          {/* Static micro-trust strip (per locked decision: no count-up here). */}
          <motion.div
            {...reveal(prefersReducedMotion ? 0 : 0.2)}
            className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-2 text-sm text-text-secondary"
          >
            <span className="inline-flex items-center gap-1.5 font-semibold text-text-main">
              <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" aria-hidden="true" />
              5.0
              <span className="font-normal text-text-secondary">on Google</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
              &lt;30 min response
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
              MoHFW 2020 compliant
            </span>
          </motion.div>
        </div>

        {/* T85 PR2 — QuickBookCard mount removed. PR5 prep note: three
            CMS-side surfaces still link to `#hero-booking-form`
            (`src/constants/cms/legal.ts`, `src/constants/cms/pages.ts`,
            `src/constants/cms/home.ts`). PR5 audits + updates those
            anchor targets. Anchor lands at top of hero in the interim. */}
      </div>
    </section>
  );
}
