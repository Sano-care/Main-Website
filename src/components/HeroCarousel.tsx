"use client";

// Hero-right carousel. Slide 0 is the FROZEN lead: the Pulse app / launch
// countdown card (HeroAppSlide). Slides 1..n are the brand service images,
// reachable by swiping right.
//
// No autoplay — slide 0 is the default anchor and must not be buried; the user
// swipes (or uses the arrows / dots) to reach the service images. embla gives
// accessible keyboard + touch swipe with scroll-snap; loop is off so slide 0 is
// a true start. Reduced motion clamps the transition to instant.

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useReducedMotion } from "framer-motion";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { HeroAppSlide } from "./marketing/HeroAppSlide";

interface ImageSlide {
  src: string;
  alt: string;
}

// Service images (the frozen app slide is prepended as slide 0). To add or
// reorder, edit this array + drop the image into public/hero-carousel/.
const SERVICE_SLIDES: ImageSlide[] = [
  { src: "/hero-carousel/01-critical-care-recovery.jpeg", alt: "Critical Care Recovery Monitoring" },
  { src: "/hero-carousel/02-trusted-care-every-stage.jpeg", alt: "Trusted Care for Every Stage of Life" },
  { src: "/hero-carousel/03-experienced-doctors-nurses.jpeg", alt: "Experienced Doctors and Qualified Nurses" },
];

const TOTAL = SERVICE_SLIDES.length + 1; // +1 for the frozen app slide

// Shared per-slide frame — taller on mobile so the app card breathes, wide on
// desktop to match the service artwork. Images object-cover into it.
const SLIDE_FRAME =
  "relative min-w-0 shrink-0 grow-0 basis-full aspect-[4/3] lg:aspect-[2.4/1]";

export function HeroCarousel() {
  const prefersReducedMotion = useReducedMotion();

  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: false,
    align: "start",
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
      className="relative w-full overflow-hidden rounded-3xl shadow-xl shadow-slate-900/10"
      role="region"
      aria-roledescription="carousel"
      aria-label="Sanocare Pulse app and service highlights"
    >
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex">
          {/* Slide 0 — frozen app / countdown lead */}
          <div
            className={SLIDE_FRAME}
            role="group"
            aria-roledescription="slide"
            aria-label={`1 of ${TOTAL}`}
          >
            <HeroAppSlide />
          </div>

          {/* Service image slides */}
          {SERVICE_SLIDES.map((slide, i) => (
            <div
              key={slide.src}
              className={SLIDE_FRAME}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 2} of ${TOTAL}`}
            >
              <Image
                src={slide.src}
                alt={slide.alt}
                fill
                loading="lazy"
                sizes="(min-width: 1024px) 800px, 100vw"
                className="object-cover object-center"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Bottom scrim — keeps the dots legible over both the blue card and photos. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/25 to-transparent" />

      {/* "Swipe for services" hint — only while the frozen app slide is showing. */}
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
        className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-slate-900 shadow-sm transition hover:bg-white disabled:pointer-events-none disabled:opacity-0"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={scrollNext}
        disabled={!canNext}
        aria-label="Next slide"
        className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-slate-900 shadow-sm transition hover:bg-white disabled:pointer-events-none disabled:opacity-0"
      >
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>

      {/* Dots */}
      <div
        className="absolute inset-x-0 bottom-3 flex justify-center gap-2"
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
                (active ? "w-6 bg-white" : "w-2 bg-white/50 hover:bg-white/80")
              }
            />
          );
        })}
      </div>
    </div>
  );
}
