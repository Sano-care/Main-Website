// T85 single source of truth for the four homepage service sections.
//
// Copy below is verbatim from the T85 brief (founder signed off) — DO NOT
// paraphrase, condense, or "improve". Eyebrows are derived in
// ServiceSection at render time ("Service ${i+1} of ${total}"), so the
// catalog stores only the content body. Add a new service by appending a
// ServiceConfig; the eyebrow numbering and the sticky bar both pick it
// up automatically.
//
// Service slugs (`home-visit`, `teleconsultation`, `lab-tests`,
// `medic-at-home`) are the T85 public identifiers used by the booking
// modal (PR4). The DB column `bookings.service_category` still uses
// the legacy enum `homecare | teleconsult | chronic | diagnostics`
// from migration 003. PR4 will map the T85 slug → legacy slug at the
// boundary (no DB migration in T85 unless founder picks option (b)
// at the PR4 plan-gate).
//
// PR2.5 stopgap (between PR2 and PR4): ServiceSection's coral CTA
// no longer routes to `/book?service={slug}` — that route never
// existed and was a 404 placeholder. It now calls
// `useBookingFlow().requestBooking()` directly, opening T61's
// BookingGate (OTP) or BookingModal. The slug is NOT yet pre-selected
// in the modal — PR4 extends `bookingStore` with a `preselectService`
// field and the ServiceSection callsite threads `config.slug` through.

import type { ComponentType } from "react";

export type ServiceSlug =
  | "home-visit"
  | "teleconsultation"
  | "lab-tests"
  | "medic-at-home";

export type ServiceIconKey = "home" | "video" | "flask" | "syringe";

/**
 * Discriminated union for payment policy. The booking modal (PR4)
 * branches on `kind` — non-lab services charge 50% at booking, lab
 * tests charge a fixed ₹200 collection fee with the test amount due
 * via UPI at sample collection.
 */
export type PaymentPolicy =
  | { kind: "partial-prepaid"; percent: 50 }
  | { kind: "lab-split"; collectionFee: 200 };

/**
 * Price line shape. Most services lead with "From ₹N + suffix"; the
 * lab tests row uses a bare descriptor because the test amount is
 * variable and the ₹200 collection fee is the only firm number.
 */
export type PriceLine =
  | { kind: "from"; amount: number; suffix: string }
  | { kind: "bare"; text: string };

export interface ServiceExpandable {
  /** "Pricing" body — single paragraph. */
  pricing: string;
  /** "Arrival promise" / "No waiting time" / etc. — single paragraph. */
  promise: string;
  /** Bulleted "What's included" list. */
  included: ReadonlyArray<string>;
  /** "Best for" — single line. */
  bestFor: string;
}

export interface ServiceConfig {
  slug: ServiceSlug;
  name: string;
  /**
   * Compact label for the ServiceStickyBar (T85 PR3). Sticky-bar
   * columns are too narrow for the full `name` ("Lab Tests at Home" /
   * "Teleconsultation"), so each service carries a 1–2-word version
   * here. ServiceSection still renders the long `name`; only the
   * sticky bar uses `shortName`.
   */
  shortName: string;
  iconKey: ServiceIconKey;
  priceLine: PriceLine;
  description: string;
  expandable: ServiceExpandable;
  /** Short green promise pill shown below the description. */
  promiseRow: string;
  /** Coral CTA copy. Verbatim per founder direction — do not condense. */
  ctaLabel: string;
  paymentPolicy: PaymentPolicy;
}

/**
 * Ordered list of services as they appear on the homepage. The order
 * also drives the sticky bar tab order (PR3) and the
 * `${index + 1} of ${total}` eyebrow on every section.
 */
export const SERVICES: ReadonlyArray<ServiceConfig> = [
  {
    slug: "home-visit",
    name: "Home-Visit",
    shortName: "Home-Visit",
    iconKey: "home",
    priceLine: { kind: "from", amount: 499, suffix: "per visit" },
    description:
      "A medic arrives at your door with a vitals kit. Your MBBS doctor joins on live video to diagnose and issue a signed e-prescription under MoHFW 2020.",
    expandable: {
      pricing:
        "₹499 covers medic visit + live MBBS doctor consult + signed e-prescription. No add-on charges.",
      promise: "Median time-to-medic under 30 minutes in Delhi NCR.",
      included: [
        "Trained medic (GNM / B.Sc Nursing) with vitals kit",
        "Live MBBS doctor consult on video",
        "Signed digital e-prescription",
        "All records saved to Sanocare Pulse",
      ],
      bestFor:
        "fever, BP/sugar checks, child illnesses, elderly care, post-discharge follow-up.",
    },
    promiseRow: "Median time-to-medic under 30 min",
    ctaLabel: "Book a Home-Visit",
    paymentPolicy: { kind: "partial-prepaid", percent: 50 },
  },
  {
    slug: "teleconsultation",
    name: "Teleconsultation",
    shortName: "Teleconsult",
    iconKey: "video",
    priceLine: { kind: "from", amount: 399, suffix: "per 15-min consult" },
    description:
      "A direct video consultation with an MBBS doctor. Signed digital prescription without anyone visiting your home.",
    expandable: {
      pricing: "₹399 for a 15-minute consult. No hidden charges.",
      promise:
        "Live video starts within 15 minutes of booking. No clinic queue.",
      included: [
        "Live video with MBBS doctor",
        "Signed digital e-prescription",
        "Follow-up support until case closes",
      ],
      bestFor:
        "prescription renewals, second opinions, lifestyle questions, minor concerns.",
    },
    promiseRow: "Live video within 15 minutes",
    ctaLabel: "Teleconsult a Doctor",
    paymentPolicy: { kind: "partial-prepaid", percent: 50 },
  },
  {
    slug: "lab-tests",
    name: "Lab Tests at Home",
    shortName: "Lab Tests",
    iconKey: "flask",
    priceLine: { kind: "bare", text: "₹200 collection fee + test amount" },
    description:
      "Free home sample collection by a trained phlebotomist. Choose from 1,892 tests via our Pathcore partner. Partner laboratories, signed PDF reports.",
    expandable: {
      pricing:
        "₹200 collection fee at booking + full test amount via UPI on phlebotomist's phone at collection. Tests process only after both payments confirmed.",
      promise: "Phlebotomist arrives within 90 minutes in Delhi NCR.",
      included: [
        "Free home sample collection",
        "Partner laboratory processing",
        "Reports on WhatsApp + Sanocare Pulse within 24h",
        "Choice of 1,892 tests via Pathcore",
      ],
      bestFor:
        "routine health checks, doctor-prescribed tests, pre-employment medicals.",
    },
    promiseRow: "1,892 tests · partner laboratories",
    ctaLabel: "Get Lab Tests Done",
    paymentPolicy: { kind: "lab-split", collectionFee: 200 },
  },
  {
    slug: "medic-at-home",
    name: "Medic at Home",
    shortName: "Medic Home",
    iconKey: "syringe",
    priceLine: { kind: "from", amount: 199, suffix: "per visit" },
    description:
      "Trained medic for a single procedure — injection, IV drip, wound dressing, or suture removal. No doctor consultation included.",
    expandable: {
      pricing:
        "From ₹199, varies by procedure type. No doctor consult (book a Home-Visit if you need that).",
      promise: "Under 30 minutes in Delhi NCR.",
      included: [
        "Trained medic (GNM / B.Sc Nursing)",
        "Sterile single-use supplies",
        "Procedure-specific care",
      ],
      bestFor:
        "prescribed injection administration, IV drips, wound dressing, suture removal, standalone BP/sugar check.",
    },
    promiseRow: "Under 30 min arrival",
    ctaLabel: "Call a Medic Home",
    paymentPolicy: { kind: "partial-prepaid", percent: 50 },
  },
] as const;

/** Lookup helper for the booking modal (PR4) and the sticky bar (PR3). */
export function getServiceBySlug(slug: string): ServiceConfig | undefined {
  return SERVICES.find((s) => s.slug === slug);
}

/**
 * Phantom export to keep TypeScript honest about the icon-key →
 * component shape ServiceSection consumes. ServiceIcons.tsx implements
 * the map and re-exports it as `serviceIconMap`.
 */
export type ServiceIconMap = Record<
  ServiceIconKey,
  ComponentType<{ className?: string }>
>;
