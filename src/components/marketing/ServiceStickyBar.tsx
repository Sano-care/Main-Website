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
import { SERVICES } from "@/lib/services/catalog";
import { getServiceIcon } from "./icons/ServiceIcons";

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
          const Icon = getServiceIcon(service.iconKey);
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
                <Icon
                  className={`w-5 h-5 [stroke-width:1.8] ${
                    isActive ? "text-primary" : "text-slate-500"
                  }`}
                />
                <span
                  className={`text-[10.5px] font-medium leading-none ${
                    isActive ? "text-primary" : "text-slate-600"
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
