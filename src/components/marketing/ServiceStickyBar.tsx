"use client";

// T85 PR3 — frozen 4-service sticky navigation bar (mobile-only).
//
// Replaces T61's MobileStickyBar (Book / Call / WhatsApp 3-CTA pattern)
// with a navigation pattern that mirrors the homepage's 4-section
// service stack. Tapping a column smooth-scrolls to that section.
//
// Why the swap:
//   - T85 brief makes the 4 service cards the homepage's primary booking
//     surfaces (the coral CTA inside each ServiceSection wires the
//     booking flow, per PR2.5). So a separate "Book a Visit" CTA in the
//     sticky bar is redundant.
//   - The sticky bar's new job is wayfinding — let a user on a small
//     screen jump between services without thumb-scrolling through the
//     full stack.
//
// Active-state observer:
//   - Native IntersectionObserver, not framer-motion's `useInView`.
//     `useInView` requires a ref to a React element owned by the same
//     subtree; here the sticky bar observes elements rendered by a
//     sibling (ServiceSection). Native API does the cross-component
//     DOM observation cleanly without prop-drilling refs.
//   - Threshold: 0.3 — a section is "active" once at least 30% of its
//     box is in the viewport. If two sections are simultaneously past
//     the threshold (briefly during scroll), the one with the higher
//     intersection ratio wins, so the bar reads as "what you're mostly
//     looking at right now".
//   - rootMargin pulled in on the bottom by 96px so the sticky bar's
//     own footprint doesn't count as viewport space (otherwise the
//     last section can't ever reach 30% on shorter phones).
//
// Layout notes:
//   - `md:hidden` — desktop has the full topnav + side rail.
//   - z-index 100 — sits above FloatingWhatsApp at z-90.
//   - `pb-[env(safe-area-inset-bottom)]` — iOS home-indicator clearance.
//     Tailwind v4 arbitrary-value syntax; no globals.css change needed.
//   - `backdrop-blur-[20px]` with `bg-white/95` fallback for unsupported
//     browsers (mostly older Android WebViews — still degrades to a
//     readable opaque white bar).
//   - Two-layer top shadow per mockup spec.
//
// Reduced motion: tap-scale transitions are short (100ms) and small
// (0.96); no entry animation. Safe to leave on under reduced motion.

import { useEffect, useState } from "react";
import { SERVICES, type ServiceIconKey } from "@/lib/services/catalog";

// T85 PR3 v1.1 — solid filled icons.
//
// Founder UAT flagged the lucide stroke icons as feeling "transparent
// outline" on a real device. Brief calls for SOLID brand-blue. We
// keep `getServiceIcon` (lucide line variants) in ServiceIcons.tsx for
// ServiceSection's blue-ghost circle (the line set reads better at
// 28px inside the soft-coloured tile), and inline a SECOND solid set
// here for the sticky bar.
//
// Why hand-rolled instead of lucide-with-fill: lucide's Syringe (and
// most of its medical icons) are composed of open path segments that
// don't fill — they're designed to be stroked. Setting fill on lucide
// works for Home / Video but disappears for Syringe + degrades for
// FlaskConical. Cleanest path is 4 inline single-path SVGs.
//
// Active/default colour logic (per founder UAT):
//   - Icon: ALWAYS brand blue (var(--color-primary)). No state change.
//   - Pill bg: appears on active (bg-primary/8).
//   - Label: slate-500 medium → primary semibold on active.
// The active differentiator is therefore pill bg + label
// colour/weight, not icon colour.

interface IconProps {
  className?: string;
}

const SolidIcons: Record<ServiceIconKey, (props: IconProps) => React.ReactElement> = {
  home: ({ className }) => (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 3 2 12h3v8h5v-6h4v6h5v-8h3z" />
    </svg>
  ),
  video: ({ className }) => (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4 6h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm14 3.5 4-2v9l-4-2z" />
    </svg>
  ),
  flask: ({ className }) => (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M9 2h6v2h-1v6.5l5.4 9A1.5 1.5 0 0 1 18.1 22H5.9a1.5 1.5 0 0 1-1.3-2.5L10 10.5V4H9z" />
    </svg>
  ),
  syringe: ({ className }) => (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="m21 4.5-1.5-1.5-3 3 1 1-3 3 1 1-9.5 9.5L3 22l4.5-1.5 9.5-9.5 1 1 3-3 1 1z" />
    </svg>
  ),
};

const ACTIVE_THRESHOLD = 0.3;
const STICKY_BAR_HEIGHT_PX = 96;

/**
 * Observes the homepage's 4 ServiceSection elements (looked up by
 * `id="service-{slug}"`) and reports which one is most prominently in
 * view. Returns null when none crosses the threshold (between sections
 * or above the first one).
 */
function useActiveService(slugs: ReadonlyArray<string>): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
      return;
    }

    const elements = slugs
      .map((slug) => document.getElementById(`service-${slug}`))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length === 0) return;

    // Keep a live ratio per element so we can pick the "most visible"
    // even if multiple are intersecting at once.
    const ratios = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const slug = entry.target.id.replace(/^service-/, "");
          ratios.set(slug, entry.isIntersecting ? entry.intersectionRatio : 0);
        });

        let bestSlug: string | null = null;
        let bestRatio = 0;
        ratios.forEach((ratio, slug) => {
          if (ratio >= ACTIVE_THRESHOLD && ratio > bestRatio) {
            bestSlug = slug;
            bestRatio = ratio;
          }
        });

        setActive(bestSlug);
      },
      {
        threshold: [0, ACTIVE_THRESHOLD, 0.6, 1],
        rootMargin: `0px 0px -${STICKY_BAR_HEIGHT_PX}px 0px`,
      },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [slugs]);

  return active;
}

function scrollToService(slug: string) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(`service-${slug}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function ServiceStickyBar() {
  // Stable slug list — the SERVICES catalog is `as const`, so the
  // identity of this array would change on every render if we mapped
  // inline. Compute once.
  const [slugs] = useState(() => SERVICES.map((s) => s.slug));
  const active = useActiveService(slugs);

  return (
    <nav
      aria-label="Service navigation"
      className="fixed bottom-0 left-0 right-0 z-[100] md:hidden bg-white/95 backdrop-blur-[20px] border-t border-slate-200 shadow-[0_-4px_12px_rgba(0,0,0,0.04),0_-1px_3px_rgba(0,0,0,0.06)] pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="flex">
        {SERVICES.map((service) => {
          const Icon = SolidIcons[service.iconKey];
          const isActive = active === service.slug;
          return (
            <li key={service.slug} className="flex-1">
              <button
                type="button"
                onClick={() => scrollToService(service.slug)}
                aria-label={`Jump to ${service.name}`}
                aria-current={isActive ? "true" : undefined}
                className={`w-full flex flex-col items-center justify-center gap-1 min-h-[52px] py-2 transition-colors duration-150 active:scale-[0.96] ${
                  isActive ? "bg-primary/8" : ""
                }`}
              >
                {/* Icon is ALWAYS brand blue — no state change. The
                    active differentiator is the pill bg + label
                    weight/colour. */}
                <Icon className="w-5 h-5 text-primary" />
                <span
                  className={`text-[10.5px] leading-none transition-colors ${
                    isActive
                      ? "text-primary font-semibold"
                      : "text-slate-500 font-medium"
                  }`}
                >
                  {service.shortName}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
