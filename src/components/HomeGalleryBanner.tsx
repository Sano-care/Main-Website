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
    // Pathcore launch announcement — leads the carousel. Added as part
    // of the diagnostics co-branding announcement; the image is the
    // approved Pathcore Launch Kit slide at 1080×1350 (same shape as
    // the existing slides, so no layout changes).
    src: "/banner/optimized/0-pathcore-launch.jpg",
    alt: "Sanocare partners with Pathcore Diagnostics for home lab tests across South Delhi",
  },
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

// ---------------------------------------------------------------------------
// Slides-per-view by breakpoint (matches Tailwind's md=768 / lg=1024).
// SSR-safe default = 1; first client render hydrates the real value.
// ---------------------------------------------------------------------------
function computeSlidesPerView(): number {
  if (typeof window === "undefined" || !window.matchMedia) return 1;
  if (window.matchMedia("(min-width: 1024px)").matches) return 3;
  if (window.matchMedia("(min-width: 768px)").matches) return 2;
  return 1;
}

export function HomeGalleryBanner() {
  const slides = SLIDES; // single source of truth — swap for fetched data later
  const slideCount = slides.length;

  const [slidesPerView, setSlidesPerView] = useState<number>(1);
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [touching, setTouching] = useState(false);

  const rootRef = useRef<HTMLElement>(null);
  const touchStartX = useRef<number | null>(null);

  // -------------------------------------------------------------------------
  // Slides-per-view follows the viewport. Re-evaluated on resize so dragging
  // a window between breakpoints recomputes without a reload.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === "undefined") return;
    const apply = () => setSlidesPerView(computeSlidesPerView());
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  // Reachable starting positions = slideCount - slidesPerView + 1. The track
  // can stop at any of these; positions beyond would show empty space past
  // the final slide, which the spec forbids ("never shows blank space").
  const reachableCount = useMemo(
    () => Math.max(1, slideCount - slidesPerView + 1),
    [slideCount, slidesPerView],
  );

  // Clamp index when slidesPerView shrinks (e.g. mobile → desktop resize
  // moves max from 5 down to 3). Without this, you'd briefly translate past
  // the end of the track.
  useEffect(() => {
    setIndex((i) => Math.min(i, reachableCount - 1));
  }, [reachableCount]);

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
  // Navigation — modulo on reachableCount so the loop length adapts to
  // slidesPerView (1-up wraps over 6, 2-up over 5, 3-up over 4).
  // -------------------------------------------------------------------------
  const goTo = useCallback(
    (next: number) => {
      setIndex(((next % reachableCount) + reachableCount) % reachableCount);
    },
    [reachableCount],
  );
  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const prev = useCallback(() => goTo(index - 1), [goTo, index]);

  // -------------------------------------------------------------------------
  // Autoplay — off when reduced-motion is set, hover-paused, touch-paused,
  // or when there's only one reachable position (nothing to advance to).
  // Always steps by ONE image, regardless of slidesPerView.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (reducedMotion || hovering || touching) return;
    if (reachableCount <= 1) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % reachableCount);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [reducedMotion, hovering, touching, reachableCount]);

  // -------------------------------------------------------------------------
  // Keyboard: Left / Right when the carousel (or anything inside) is focused.
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
  // for the duration of the gesture.
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
  // Live region — announces the leftmost-visible slide on each change.
  // 1-up reads "Slide N of M: alt"; multi-up reads "Showing slides N to K".
  // -------------------------------------------------------------------------
  const liveLabel = useMemo(() => {
    if (slidesPerView === 1) {
      return `Slide ${index + 1} of ${slideCount}: ${slides[index].alt}`;
    }
    const last = Math.min(index + slidesPerView, slideCount);
    return `Showing slides ${index + 1} to ${last} of ${slideCount}`;
  }, [index, slideCount, slidesPerView, slides]);

  // -------------------------------------------------------------------------
  // Visual math.
  //   - Each slide occupies (100 / slideCount)% of the track — constant.
  //   - Track is (slideCount * 100 / slidesPerView)% of the viewport — so a
  //     1-up viewport sees a 600% track, 2-up sees 300%, 3-up sees 200%.
  //   - Translating the track by (index * 100 / slideCount)% of itself moves
  //     it by exactly ONE slide-width regardless of slidesPerView.
  // -------------------------------------------------------------------------
  const trackWidthPct = (slideCount * 100) / slidesPerView;
  const slideWidthOnTrackPct = 100 / slideCount;
  const translatePct = (index * 100) / slideCount;

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
      className="w-full px-4 sm:px-6 lg:px-8 pt-4 pb-2 sm:pt-6 sm:pb-3"
    >
      <div className="mx-auto w-full max-w-[1280px]">
        {/* Viewport (no rounding / shadow — those live on each tile now,
            so multi-up and single-up render consistently). */}
        <div className="relative w-full">
          <div className="overflow-hidden">
            <div
              className={
                "flex " +
                (reducedMotion ? "" : "transition-transform duration-500 ease-out")
              }
              style={{
                width: `${trackWidthPct}%`,
                transform: `translateX(-${translatePct}%)`,
              }}
            >
              {slides.map((s, i) => {
                const isInView = i >= index && i < index + slidesPerView;
                return (
                  <div
                    key={s.src}
                    role="group"
                    aria-roledescription="slide"
                    aria-label={`Slide ${i + 1} of ${slideCount}`}
                    aria-hidden={!isInView}
                    className="shrink-0 px-2"
                    style={{ width: `${slideWidthOnTrackPct}%` }}
                  >
                    {/* Tile — rounded card. aspect-[4/5] keeps all heights
                        equal across the row regardless of slidesPerView. */}
                    <div
                      className="relative w-full rounded-[20px] shadow-xl shadow-slate-900/10 overflow-hidden bg-slate-100"
                      style={{ aspectRatio: "4 / 5" }}
                    >
                      <Image
                        src={s.src}
                        alt={s.alt}
                        fill
                        sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                        priority={i === 0}
                        loading={i === 0 ? undefined : "lazy"}
                        className="object-cover"
                        draggable={false}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Prev / next arrows — overlay the viewport, not individual tiles,
              so they sit at the section edges regardless of slidesPerView. */}
          <button
            type="button"
            onClick={prev}
            aria-label="Previous slide"
            className="absolute left-1 sm:left-3 top-1/2 -translate-y-1/2 size-9 rounded-full bg-white/80 backdrop-blur-sm text-slate-800 shadow-md hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 transition-colors flex items-center justify-center"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Next slide"
            className="absolute right-1 sm:right-3 top-1/2 -translate-y-1/2 size-9 rounded-full bg-white/80 backdrop-blur-sm text-slate-800 shadow-md hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 transition-colors flex items-center justify-center"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          {/* Screen-reader-only live region so AT users hear slide changes. */}
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {liveLabel}
          </div>
        </div>

        {/* Dot row — one per REACHABLE position (not per slide). For 3-up
            with 6 slides, that's 4 dots; 2-up → 5; 1-up → 6. */}
        <div
          className="mt-3 flex items-center justify-center gap-2"
          aria-label="Choose slide"
        >
          {Array.from({ length: reachableCount }, (_, i) => {
            const active = i === index;
            return (
              <button
                key={i}
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
