// Service pricing configuration — Sanocare SKU catalog (locked May 2026)
//
// Anchor model: a GNM / B.Sc Nursing-qualified medic visits, an MBBS doctor joins on live video
// and issues a signed e-prescription per MoHFW Telemedicine Practice Guidelines 2020.
//
// All prices use "Starting from" semantics — the displayed price is the
// minimum a visitor will be charged; specialist or extended-time visits
// may exceed this. Healthcare services are GST-exempt.
//
// Payment model (post-T85):
//   - Home-Visit / Teleconsultation / Medic at Home: 50% rounded up at
//     booking via getServiceHalfRoundedUp(), balance at case close
//   - Lab Tests: full grand total prepaid OR ₹200 collection fee
//     (PR4b dual mode); see /api/lab/create-booking-prepaid
//   - Legacy fallback: flat ₹249 booking fee (BOOKING_FEE below) — still
//     used by Navbar's "Book a Visit" pill via the @deprecated
//     BookingModal. New code paths use getServiceHalfRoundedUp instead.

export const BASE_PRICE = 499; // Standard home visit (medic + virtual doctor + e-Rx, first 15 min)
export const ADDITIONAL_PRICE_PER_5MIN = 100; // Extended consult beyond 15 min
/**
 * @deprecated T85 PR5 — legacy flat booking fee. Still used by Navbar's
 * "Book a Visit" pill → BookingModal (no-slug fallback). New service-led
 * flows use `getServiceHalfRoundedUp()` instead. Retire when Navbar's
 * pill is repointed to a service-led default.
 */
export const BOOKING_FEE = 249; // legacy flat fee — see @deprecated above
export const NIGHT_SURGE_PRICE = 799; // After 10 pm — +60% on the anchor SKU

export interface ServicePricing {
  label: string;
  price: number; // "Starting from" — the displayed minimum
  description: string;
  category: string;
  pricingMode: "starting_from" | "free_plus_test" | "custom";
  showOnHomepage?: boolean;
}

export const SERVICE_PRICING: Record<string, ServicePricing> = {
  // ===== Primary SKUs shown on the homepage =====
  homecare: {
    label: "Home visit",
    price: 499,
    description:
      "GNM / B.Sc Nursing-qualified medic on site, MBBS doctor on live video, 15-min consult, signed e-prescription.",
    category: "Homecare",
    pricingMode: "starting_from",
    showOnHomepage: true,
  },
  nursing: {
    label: "Nursing-only visit",
    price: 199,
    description:
      "Single procedure — injection, IV, wound dressing, sample collection. No doctor consult.",
    category: "Nursing",
    pricingMode: "starting_from",
    showOnHomepage: true,
  },
  teleconsult: {
    label: "Teleconsultation",
    price: 399,
    description:
      "15-min video consult with an MBBS doctor. Signed digital e-prescription under MoHFW Telemedicine Practice Guidelines 2020.",
    category: "Teleconsult",
    pricingMode: "starting_from",
    showOnHomepage: true,
  },
  diagnostics: {
    label: "Lab sample at home",
    price: 0,
    description:
      "Free home sample collection across Kalkaji & Govindpuri Extension. Pay only for the test — 1,900+ tests via Pathcore Diagnostics.",
    category: "Diagnostics",
    pricingMode: "free_plus_test",
    showOnHomepage: true,
  },
  // ===== Secondary SKUs (auto-applied, not shown in the homepage selector) =====
  night: {
    label: "Night visit (after 10 pm)",
    price: NIGHT_SURGE_PRICE,
    description:
      "After-hours home visit — same scope as a standard home visit, with a +60% surge applied automatically.",
    category: "Homecare",
    pricingMode: "starting_from",
    showOnHomepage: false,
  },
  extended_consult: {
    label: "Extended consultation",
    price: ADDITIONAL_PRICE_PER_5MIN,
    description:
      "₹100 per additional 5 minutes beyond the 15-min standard consult — auto-billed on case close.",
    category: "Homecare",
    pricingMode: "custom",
    showOnHomepage: false,
  },
};

/**
 * Returns the "starting from" rupee price for a given service slug.
 * Falls back to the BASE_PRICE for any unknown slug so the booking flow
 * never charges ₹0 by accident (lab/diagnostics is the only legitimate
 * ₹0-at-booking case and is short-circuited upstream in useBookingSubmit).
 */
export function getServicePrice(serviceCategory: string): number {
  const sku = SERVICE_PRICING[serviceCategory];
  if (!sku) return BASE_PRICE;
  return sku.price;
}

/**
 * T85 PR4a — 50% prepaid amount, rounded UP to the nearest ₹1.
 *
 * Examples (verified vs founder spec in T85 brief):
 *   home-visit       → 499 → ceil(499/2) = 250
 *   teleconsultation → 399 → ceil(399/2) = 200
 *   medic-at-home    → 199 → ceil(199/2) = 100
 *
 * The caller passes the SERVICE_PRICING key (legacy slug). The T85 →
 * pricing-key translation lives in `src/lib/booking/serviceMapper.ts`
 * (`t85ToPricingKey`); UI callers pass the result of that mapper here.
 *
 * UPI doesn't handle paisa, so we round UP to ensure the patient is
 * never under-charged and ops never has to chase a ₹0.50 reconciliation.
 */
export function getServiceHalfRoundedUp(pricingKey: string): number {
  const sku = SERVICE_PRICING[pricingKey];
  if (!sku) return Math.ceil(BASE_PRICE / 2);
  return Math.ceil(sku.price / 2);
}

/**
 * T85 PR4a — remaining balance shown above the Step 3 CTA. Mirrors
 * `getServiceHalfRoundedUp` semantics so the two amounts always sum to
 * the full price (no off-by-one due to two independent rounds).
 *
 *   full = half_rounded_up + remaining
 *   ⇒ remaining = full - half_rounded_up
 *
 * For ₹399: half_rounded_up = 200, remaining = 199.
 */
export function getServiceRemainingAfterHalf(pricingKey: string): number {
  const sku = SERVICE_PRICING[pricingKey];
  const full = sku?.price ?? BASE_PRICE;
  return full - getServiceHalfRoundedUp(pricingKey);
}

export function formatPrice(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}
