// T85 PR4a — boundary translation between T85 service slugs and the
// runtime concepts they touch:
//
//   1. SERVICE_PRICING keys (src/constants/pricing.ts) — legacy slugs:
//        homecare | teleconsult | diagnostics | nursing
//      (nursing is the pricing key for what T85 calls "medic-at-home",
//       even though M003's CHECK constraint never had `nursing` — the
//       price table predates the CHECK and was never cleaned up.)
//
//   2. bookings.service_category column — accepts BOTH legacy and T85
//      slugs after M039. New writes always use the T85 slug.
//
//   3. Display copy — friendly names used in the Rampwin lead-alert
//      template and the Step 4 confirmation card.
//
// Keeping all three maps in one file means a new service in catalog.ts
// can't accidentally diverge from its pricing or DB value — every site
// that touches a slug imports from here.

import type { ServiceSlug } from "@/lib/services/catalog";

/**
 * Map a T85 slug to its key in SERVICE_PRICING. Note the asymmetry:
 *   - home-visit       → homecare    (matches M003 legacy)
 *   - teleconsultation → teleconsult (matches M003 legacy)
 *   - lab-tests        → diagnostics (matches M003 legacy)
 *   - medic-at-home    → nursing     (pricing-only — NOT a legal value
 *                                     in bookings.service_category;
 *                                     was historically rolled into
 *                                     'homecare' per M003's backfill)
 */
export function t85ToPricingKey(slug: ServiceSlug): string {
  switch (slug) {
    case "home-visit":
      return "homecare";
    case "teleconsultation":
      return "teleconsult";
    case "lab-tests":
      return "diagnostics";
    case "medic-at-home":
      return "nursing";
  }
}

/**
 * Friendly display name for the Rampwin `aarogya_lead_alert` template's
 * {{3}} variable and any other "what did the patient book" surface.
 * Verbatim per the T85 brief.
 */
export function t85ServiceDisplayName(slug: ServiceSlug): string {
  switch (slug) {
    case "home-visit":
      return "Home-Visit";
    case "teleconsultation":
      return "Teleconsultation";
    case "lab-tests":
      return "Lab Tests at Home";
    case "medic-at-home":
      return "Medic at Home";
  }
}

/**
 * Reverse map: a value read from `bookings.service_category` (either
 * legacy or T85) → the T85 slug we display to the user. Returns null
 * for `chronic` since that's a separate product line (CareHub
 * subscriptions, not in T85's homepage catalog).
 *
 * Useful for /ops or /pulse surfaces that need to render older rows in
 * T85 vocabulary without writing back to the DB.
 */
export function dbToT85Slug(value: string): ServiceSlug | null {
  switch (value) {
    // T85 values pass through unchanged.
    case "home-visit":
    case "teleconsultation":
    case "lab-tests":
    case "medic-at-home":
      return value;
    // Legacy values map to their T85 equivalents. `homecare` is
    // ambiguous (could be home-visit OR medic-at-home historically) —
    // we default to home-visit since that's the more common service.
    // Ops surfaces that need finer granularity should read ancillary
    // columns (e.g. presence of `selected_tests`) to disambiguate.
    case "homecare":
      return "home-visit";
    case "teleconsult":
      return "teleconsultation";
    case "diagnostics":
      return "lab-tests";
    // Out of T85 scope — return null so callers can render a fallback.
    case "chronic":
      return null;
    default:
      return null;
  }
}
