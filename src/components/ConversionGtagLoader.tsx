"use client";

import { useEffect } from "react";

/**
 * Minimal gtag.js loader for pages that need to fire conversion events on
 * user interaction (e.g. WhatsApp CTA click). Mounted by callers as a
 * client component on specific pages where a conversion handler runs.
 *
 * What it does:
 *   1. Initialises `window.dataLayer` + `window.gtag` if not already set
 *      (the inline `ConsentDefaultScript` runs site-wide and creates a
 *      `gtag()` function LOCALLY inside its IIFE — it does NOT expose
 *      `window.gtag` globally, so React-land code can't reach gtag
 *      without this loader).
 *   2. Injects the gtag.js <script> for the GA4 measurement ID if it
 *      isn't already in the page.
 *   3. Runs `gtag('js', new Date())` + `gtag('config', GA4, {
 *      transport_type: 'beacon' })` so subsequent gtag('event', …) calls
 *      route through GA4 (which is linked to the Google Ads account and
 *      handles the AW conversion auto-routing).
 *
 * What it deliberately does NOT do:
 *   - It does NOT fire any event on mount. No landing-conversion fire.
 *     The whole point of this loader (vs reusing PaidConversionFire) is
 *     to enable click-based conversion firing on /services/home-nurse-
 *     delhi-ncr without over-counting on landing. The campaign's
 *     intended optimisation signal is "user reached WhatsApp", not "user
 *     landed on the page".
 *   - It does NOT set Consent Mode defaults — `ConsentDefaultScript`
 *     handles that site-wide, before this component mounts.
 *
 * Same GA4 measurement ID + same gtag-load script tag id (`ga4-js`) as
 * `PaidConversionFire` so the two components share the loaded script if
 * both mount on the same page (defensive — they don't today, since
 * PaidConversionFire is homepage-only and this loader is /services/
 * [slug]-only, but the shared id keeps gtag.js loading exactly once if
 * routes ever overlap).
 */
const GA4 = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID || "G-VSP31JFVVJ";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
  }
}

export function ConversionGtagLoader() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const dataLayer = (window.dataLayer = window.dataLayer || []);
      const gtag = (...args: unknown[]) => {
        dataLayer.push(args);
      };
      window.gtag = window.gtag || gtag;

      if (!GA4) return;

      if (!document.getElementById("ga4-js")) {
        const s = document.createElement("script");
        s.id = "ga4-js";
        s.async = true;
        s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA4;
        document.head.appendChild(s);
      }

      gtag("js", new Date());
      gtag("config", GA4, { transport_type: "beacon" });
    } catch {
      // Tracking must never break the page.
    }
  }, []);

  return null;
}
