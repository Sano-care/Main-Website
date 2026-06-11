"use client";

import { Stethoscope, TestTube, Home, UserPlus } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useBookingFlow } from "@/hooks/useBookingFlow";
import type { ServiceSlug } from "@/lib/services/catalog";

/**
 * T90 Pulse v1 Phase 1 Slice 2 — Home tile grid (Surface 6).
 *
 * 4 service tiles, 2×2 on every breakpoint (founder Step-11 decision (C)).
 *   1. Talk to a doctor    → teleconsultation (requestBookingForService)
 *   2. Get tested at home  → lab-tests        (requestBookingForLab)
 *   3. Get Care at Home    → home-visit       (requestBookingForService)
 *   4. Book a medic        → medic-at-home    (requestBookingForService)
 *
 * Booking entry path uses the canonical `useBookingFlow()` hook — same
 * pattern as Navbar primary CTA, ServiceSection, FloatingWhatsApp, etc.
 * Zero new modal-prop surface; tiles dispatch through the existing
 * bookingStore.serviceSlug + isModalOpen state machinery (founder
 * Step-11 decision (A)).
 *
 * `<PulseBookingPhonePrime />` mounts adjacent and seeds
 * `phoneVerifiedUntil` from the live Pulse cookie, so tile taps DON'T
 * trip the BookingGate OTP modal (Pulse-authed users are already past
 * the OTP wall — founder Step-11 decision (B)).
 *
 * Tile visual spec (brief):
 *   Height:   140px mobile, 160px desktop
 *   Border:   border-gray-200 rounded-2xl bg-white (NO shadow, NO gradient)
 *   Padding:  p-4
 *   Icon:     32px (h-8 w-8) top-left, text-primary
 *   Headline: Inter Semibold 16-18px, text-gray-900
 *   Subtext:  Inter Regular 12-13px, text-gray-500, line-clamp-2
 *   Active:   active:scale-[0.97] active:bg-gray-50 (100ms ease-out)
 *   aria:     concatenated headline + ". " + subtext + "."
 */

interface Tile {
  /** Catalog slug — passed to requestBookingForService for non-lab tiles. */
  slug: ServiceSlug;
  /** True for the "Get tested at home" tile — routes to LabBasketWindow. */
  isLab: boolean;
  Icon: LucideIcon;
  headline: string;
  subtext: string;
}

const TILES: readonly Tile[] = [
  {
    slug: "teleconsultation",
    isLab: false,
    Icon: Stethoscope,
    headline: "Talk to a doctor",
    subtext: "Video call with an MBBS doctor",
  },
  {
    slug: "lab-tests",
    isLab: true,
    Icon: TestTube,
    headline: "Get tested at home",
    subtext: "Sample collected at home, reports on WhatsApp",
  },
  {
    slug: "home-visit",
    isLab: false,
    Icon: Home,
    headline: "Get Care at Home",
    subtext: "Sanocare team comes to your door",
  },
  {
    slug: "medic-at-home",
    isLab: false,
    Icon: UserPlus,
    headline: "Book a medic",
    subtext: "Trained nurse for injections, dressings, care",
  },
];

export default function PulseHomeTiles() {
  const { requestBookingForService, requestBookingForLab } = useBookingFlow();

  function handleTap(tile: Tile) {
    if (tile.isLab) {
      requestBookingForLab();
    } else {
      requestBookingForService(tile.slug);
    }
  }

  return (
    <section
      aria-label="Book a Sanocare service"
      className="grid grid-cols-2 gap-3"
    >
      {TILES.map((tile) => {
        const Icon = tile.Icon;
        return (
          <button
            key={tile.slug}
            type="button"
            onClick={() => handleTap(tile)}
            aria-label={`${tile.headline}. ${tile.subtext}.`}
            className="flex h-[140px] flex-col rounded-2xl border border-gray-200 bg-white p-4 text-left transition-transform duration-100 ease-out active:scale-[0.97] active:bg-gray-50 lg:h-[160px]"
          >
            <Icon
              className="h-8 w-8 text-primary"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <h3 className="mt-3 text-base font-semibold leading-tight text-gray-900 lg:text-lg">
              {tile.headline}
            </h3>
            <p className="mt-1 line-clamp-2 text-xs leading-snug text-gray-500 lg:text-sm">
              {tile.subtext}
            </p>
          </button>
        );
      })}
    </section>
  );
}
