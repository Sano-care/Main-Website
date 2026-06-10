"use client";

// Hero carousel — 3 brand-aligned slides rotated on a 5s auto-advance.
// Replaces the single static hero image in Hero.tsx per founder direction
// (2026-06-09). Image artwork carries baked-in service-line headlines;
// the H1 + sub-headline + trust strip stay anchored above and below this
// component as text so the brand promise persists across slides.
//
// Library: embla-carousel-react. ~6kb gzipped, accessible (keyboard +
// swipe), no transition-locking. Standard React choice; founder
// authorised the install.
//
// Aspect ratio: 2.4 / 1 — keeps the total Hero (H1 + sub + carousel +
// trust strip) inside the above-the-fold viewport on 375px mobile.
//
// Reduced motion: when the OS-level preference is set, auto-advance is
// disabled and the embla transition is set to instant (`duration: 0`)
// so slide changes don't animate. Manual swipe + dot navigation still
// work — the patient just doesn't see motion they didn't initiate.

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useReducedMotion } from "framer-motion";
import useEmblaCarousel from "embla-carousel-react";

interface Slide {
  src: string;
  alt: string;
}

// Slides hard-coded; the artwork is content-loaded with its own
// headlines so a CMS edit doesn't make sense at the per-slide level.
// To add or reorder slides, edit this array + drop the image into
// public/hero-carousel/ with the same naming convention.
const SLIDES: Slide[] = [
  {
    src: "/hero-carousel/01-critical-care-recovery.jpeg",
    alt: "Critical Care Recovery Monitoring",
  },
  {
    src: "/hero-carousel/02-trusted-care-every-stage.jpeg",
    alt: "Trusted Care for Every Stage of Life",
  },
  {
    src: "/hero-carousel/03-experienced-doctors-nurses.jpeg",
    alt: "Experienced Doctors and Qualified Nurses",
  },
];

const AUTO_ADVANCE_MS = 5000;

export function HeroCarousel() {
  const prefersReducedMotion = useReducedMotion();

  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    align: "start",
    // Reduced motion: clamp the slide transition to instant. Embla
    // still tracks position; the slide just snaps.
    duration: prefersReducedMotion ? 0 : 25,
  });

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  // Track which dot is active.
  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setSelectedIndex(emblaApi.selectedScrollSnap());
    emblaApi.on("select", onSelect);
    onSelect();
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi]);

  // Auto-advance every AUTO_ADVANCE_MS. Paused on hover (desktop).
  // Disabled entirely under prefers-reduced-motion.
  useEffect(() => {
    if (!emblaApi || prefersReducedMotion || isHovered) return;
    const id = setInterval(() => {
      emblaApi.scrollNext();
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [emblaApi, prefersReducedMotion, isHovered]);

  const scrollTo = useCallback(
    (index: number) => {
      if (emblaApi) emblaApi.scrollTo(index);
    },
    [emblaApi],
  );

  return (
    <div
      className="relative w-full overflow-hidden rounded-3xl shadow-xl shadow-slate-900/10"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      role="region"
      aria-roledescription="carousel"
      aria-label="Sanocare service highlights"
    >
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex">
          {SLIDES.map((slide, i) => (
            <div
              key={slide.src}
              className="relative min-w-0 shrink-0 grow-0 basis-full aspect-[2.4/1]"
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${SLIDES.length}`}
            >
              <Image
                src={slide.src}
                alt={slide.alt}
                fill
                // Slide 1 is above-the-fold; eager + priority. 2 + 3
                // lazy-load to keep first-paint snappy on mobile.
                priority={i === 0}
                loading={i === 0 ? "eager" : "lazy"}
                sizes="(min-width: 1024px) 800px, 100vw"
                className="object-cover object-center"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Dots */}
      <div
        className="absolute inset-x-0 bottom-3 flex justify-center gap-2"
        role="tablist"
        aria-label="Slide navigation"
      >
        {SLIDES.map((_, i) => {
          const active = selectedIndex === i;
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => scrollTo(i)}
              className={
                "h-2 rounded-full transition-all " +
                (active
                  ? "w-6 bg-primary"
                  : "w-2 bg-white/70 hover:bg-white")
              }
            />
          );
        })}
      </div>
    </div>
  );
}
