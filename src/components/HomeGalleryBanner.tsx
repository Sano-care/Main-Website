"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";

// ---------------------------------------------------------------------------
// Phase 1: slide list lives here. Replace this constant with a fetched
// array in Phase 2 (DB-backed, edited from ops) — keep the same shape
// ({ src, alt }) and nothing in the component below needs to change.
// ---------------------------------------------------------------------------

type Slide = { src: string; alt: string };

const SLIDES: ReadonlyArray<Slide> = [
  {
    src: "/banner/optimized/1-experienced-team.jpg",
    alt: "Sanocare's experienced doctors and qualified nurses",
  },
  {
    src: "/banner/optimized/2-elderly-care.jpg",
    alt: "A Sanocare nurse providing attentive elderly care at home",
  },
  {
    src: "/banner/optimized/3-chronic-care.jpg",
    alt: "A Sanocare nurse supporting an elderly patient with chronic care monitoring",
  },
  {
    src: "/banner/optimized/4-home-lab-test.jpg",
    alt: "Sanocare conducting a trusted lab test at the patient's home",
  },
  {
    src: "/banner/optimized/5-home-vaccination.jpg",
    alt: "A family receiving home vaccination from a Sanocare nurse",
  },
  {
    src: "/banner/optimized/6-home-care-anytime.jpg",
    alt: "Sanocare home healthcare available anytime",
  },
];

const AUTOPLAY_MS = 5000;

export function HomeGalleryBanner() {
  const slides = SLIDES; // single source of truth — swap for fetched data later
  const slideCount = slides.length;

  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  // Pause is independent for hover (mouse) + touch — either condition
  // freezes autoplay until BOTH clear.
  const [hovering, setHovering] = useState(false);
  const [touching, setTouching] = useState(false);

  const rootRef = useRef<HTMLElement>(null);
  const touchStartX = useRef<number | null>(null);

  // -------------------------------------------------------------------------
  // Reduced-motion media query — re-evaluated on change so toggling the OS
  // preference at runtime takes effect without a reload.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mql.matches);
    apply();
    mql.addEventListener?.("change", apply);
    return () => mql.removeEventListener?.("change", apply);
  }, []);

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------
  const goTo = useCallback(
    (next: number) => {
      // Loop infinitely in both directions.
      setIndex(((next % slideCount) + slideCount) % slideCount);
    },
    [slideCount],
  );
  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const prev = useCallback(() => goTo(index - 1), [goTo, index]);

  // -------------------------------------------------------------------------
  // Autoplay — off when reduced-motion is set OR any pause condition holds.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (reducedMotion || hovering || touching) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % slideCount);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [reducedMotion, hovering, touching, slideCount]);

  // -------------------------------------------------------------------------
  // Keyboard: Left / Right when the carousel (or anything inside) is focused.
  // We listen on the root so any focusable descendant (dot button etc.) also
  // gets the shortcuts.
  // -------------------------------------------------------------------------
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
    },
    [next, prev],
  );

  // -------------------------------------------------------------------------
  // Touch swipe — record startX on touchstart, fire on touchend if the
  // horizontal delta exceeds the threshold. Touching also pauses autoplay
  // for the duration of the gesture (and one tick after, via touchend).
  // -------------------------------------------------------------------------
  const SWIPE_THRESHOLD_PX = 50;
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    setTouching(true);
    touchStartX.current = e.touches[0]?.clientX ?? null;
  }, []);
  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const startX = touchStartX.current;
      const endX = e.changedTouches[0]?.clientX ?? null;
      touchStartX.current = null;
      setTouching(false);
      if (startX == null || endX == null) return;
      const dx = endX - startX;
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
      if (dx < 0) next();
      else prev();
    },
    [next, prev],
  );

  // -------------------------------------------------------------------------
  // Live-region label for screen-reader users. Updates as the slide moves.
  // -------------------------------------------------------------------------
  const liveLabel = useMemo(
    () => `Slide ${index + 1} of ${slideCount}: ${slides[index].alt}`,
    [index, slideCount, slides],
  );

  return (
    <section
      ref={rootRef}
      aria-roledescription="carousel"
      aria-label="Sanocare in action"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onKeyDown={onKeyDown}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="w-full px-4 sm:px-6 pt-4 pb-2 sm:pt-6 sm:pb-3"
    >
      <div className="mx-auto w-full max-w-[480px]">
        {/* Viewport — clips the sliding track. aspect-[4/5] gives the
            portrait frame; the image fills it via next/image fill. */}
        <div
          className="relative w-full overflow-hidden rounded-[20px] shadow-xl shadow-slate-900/10 bg-slate-100"
          style={{ aspectRatio: "4 / 5" }}
        >
          {/* Sliding track. translate-x driven by `index`; transition is
              removed under prefers-reduced-motion so the slide change is
              instantaneous. */}
          <div
            className={
              "absolute inset-0 flex h-full " +
              (reducedMotion ? "" : "transition-transform duration-500 ease-out")
            }
            style={{
              width: `${slideCount * 100}%`,
              transform: `translateX(-${(index * 100) / slideCount}%)`,
            }}
          >
            {slides.map((s, i) => (
              <div
                key={s.src}
                role="group"
                aria-roledescription="slide"
                aria-label={`Slide ${i + 1} of ${slideCount}`}
                aria-hidden={i !== index}
                className="relative h-full"
                style={{ width: `${100 / slideCount}%` }}
              >
                <Image
                  src={s.src}
                  alt={s.alt}
                  fill
                  // 1080x1350 source → 480px max on desktop, 100vw on mobile.
                  sizes="(max-width: 640px) 100vw, 480px"
                  priority={i === 0}
                  loading={i === 0 ? undefined : "lazy"}
                  className="object-cover"
                  draggable={false}
                />
              </div>
            ))}
          </div>

          {/* Prev / next arrows — overlaid on the viewport, partly
              transparent so they don't fight the image. */}
          <button
            type="button"
            onClick={prev}
            aria-label="Previous slide"
            className="absolute left-2 top-1/2 -translate-y-1/2 size-9 rounded-full bg-white/80 backdrop-blur-sm text-slate-800 shadow-md hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 transition-colors flex items-center justify-center"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Next slide"
            className="absolute right-2 top-1/2 -translate-y-1/2 size-9 rounded-full bg-white/80 backdrop-blur-sm text-slate-800 shadow-md hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 transition-colors flex items-center justify-center"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          {/* Screen-reader-only live region so AT users hear slide changes. */}
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {liveLabel}
          </div>
        </div>

        {/* Dot row — real buttons; active dot indicated via aria-current
            (and visual fill). */}
        <div
          className="mt-3 flex items-center justify-center gap-2"
          aria-label="Choose slide"
        >
          {slides.map((s, i) => {
            const active = i === index;
            return (
              <button
                key={s.src}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Go to slide ${i + 1}`}
                aria-current={active ? "true" : undefined}
                className={
                  "rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 " +
                  (active
                    ? "h-2 w-6 bg-slate-900"
                    : "h-2 w-2 bg-slate-300 hover:bg-slate-400")
                }
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
