"use client";

// Full-width hero carousel. Slide 0 is the FROZEN lead: the Pulse app / launch
// countdown card (HeroAppSlide). Slides 1..n are the brand service images.
//
// Peek layout: on desktop each slide is ~60% wide so the neighbouring slide
// peeks in and fills the rest of the width; on mobile slides are full-width
// (one at a time). No autoplay — slide 0 is the default anchor and must not be
// buried; the user swipes (or uses the arrows / dots) to reach the services.
// embla gives accessible keyboard + touch swipe with scroll-snap; loop is off
// so slide 0 is a true start. Reduced motion clamps the transition to instant.
//
// No-crop rule (2026-08-15): every service banner is ~2:1 native, so each
// service slide is framed at 2/1 with object-contain — the full image always
// shows, never cropped. The app/countdown card sizes to its own content
// (natural height on mobile, matched to the 2:1 row on desktop) so it is never
// squashed to fit the images and never forces the images to crop to fit it.

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import useEmblaCarousel from "embla-carousel-react";

import { HeroAppSlide } from "./marketing/HeroAppSlide";

interface ImageSlide {
  src: string;
  alt: string;
}

// Service images (the frozen app slide is prepended as slide 0). To add or
// reorder, edit this array + drop the image into public/hero-carousel/. Each
// image is ~2:1 native — see the 2/1 frame + object-contain below.
const SERVICE_SLIDES: ImageSlide[] = [
  { src: "/hero-carousel/01-critical-care-recovery.jpeg", alt: "Critical Care Recovery Monitoring" },
  { src: "/hero-carousel/02-trusted-care-every-stage.jpeg", alt: "Trusted Care for Every Stage of Life" },
  { src: "/hero-carousel/03-experienced-doctors-nurses.jpeg", alt: "Experienced Doctors and Qualified Nurses" },
];

const TOTAL = SERVICE_SLIDES.length + 1; // +1 for the frozen app slide

// Peek basis — full-width on mobile (one slide at a time), ~60% on desktop so
// the next slide peeks in. `shrink-0 grow-0` keeps the basis exact.
const SLIDE_BASE = "relative min-w-0 shrink-0 grow-0 basis-full sm:basis-[62%]";

export function HeroCarousel() {
  const prefersReducedMotion = useReducedMotion();

  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: false,
    align: "start",
    containScroll: "trimSnaps",
    duration: prefersReducedMotion ? 0 : 25,
  });

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(true);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => {
      setSelectedIndex(emblaApi.selectedScrollSnap());
      setCanPrev(emblaApi.canScrollPrev());
      setCanNext(emblaApi.canScrollNext());
    };
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
    onSelect();
    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
    };
  }, [emblaApi]);

  const scrollTo = useCallback((i: number) => emblaApi?.scrollTo(i), [emblaApi]);
  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  return (
    <div
      className="relative w-full"
      role="region"
      aria-roledescription="carousel"
      aria-label="Sanocare Pulse app and service highlights"
    >
      <div className="overflow-hidden" ref={emblaRef}>
        {/* items-center vertically centres slides of differing heights (the
            app card sizes to its content; images keep native 2:1). gap gives
            the peeking neighbour a clean seam. */}
        <div className="flex items-center gap-4 lg:gap-6">
          {/* Slide 0 — frozen app / countdown lead. Sizes to its own content
              on mobile; matched to the 2:1 row on desktop so the peek is tidy.
              Never forced to the image aspect (which would squash it). */}
          <div
            className={`${SLIDE_BASE} sm:aspect-[2/1] overflow-hidden rounded-[20px]`}
            role="group"
            aria-roledescription="slide"
            aria-label={`1 of ${TOTAL}`}
          >
            <HeroAppSlide />
          </div>

          {/* Service image slides — framed at native 2:1 with object-contain so
              the full banner always shows (never cropped). */}
          {SERVICE_SLIDES.map((slide, i) => (
            <div
              key={slide.src}
              className={`${SLIDE_BASE} aspect-[2/1] overflow-hidden rounded-[20px] bg-slate-100`}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 2} of ${TOTAL}`}
            >
              <Image
                src={slide.src}
                alt={slide.alt}
                fill
                loading="lazy"
                sizes="(min-width: 640px) 62vw, 92vw"
                className="object-contain object-center"
              />
            </div>
          ))}
        </div>
      </div>

      {/* "Swipe for services" hint — only while the frozen app slide is up. */}
      {selectedIndex === 0 && (
        <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/30 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
          Swipe for services →
        </div>
      )}

      {/* Prev / next arrows — fade out at the ends. */}
      <button
        type="button"
        onClick={scrollPrev}
        disabled={!canPrev}
        aria-label="Previous slide"
        className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-sm transition hover:bg-white disabled:pointer-events-none disabled:opacity-0"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={scrollNext}
        disabled={!canNext}
        aria-label="Next slide"
        className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-sm transition hover:bg-white disabled:pointer-events-none disabled:opacity-0"
      >
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>

      {/* Dots — below the carousel so they never overlap the (uncropped)
          images. Brand-blue active dot on the light section background. */}
      <div
        className="mt-4 flex justify-center gap-2"
        role="tablist"
        aria-label="Slide navigation"
      >
        {Array.from({ length: TOTAL }).map((_, i) => {
          const active = selectedIndex === i;
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={i === 0 ? "Go to the app slide" : `Go to service slide ${i}`}
              onClick={() => scrollTo(i)}
              className={
                "h-2 rounded-full transition-all " +
                (active ? "w-6 bg-primary" : "w-2 bg-slate-300 hover:bg-slate-400")
              }
            />
          );
        })}
      </div>
    </div>
  );
}
