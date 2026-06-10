"use client";

import { useEffect, useRef } from "react";

// Fires the paid-conversion chain when a Google Ads click lands here — detected
// by ?gclid= in the URL, so organic visitors never trigger a false conversion.
// Same posture as /wa and the (now removed) /book-* pages: GA4 + Google Ads fire
// cookieless under Consent Mode default-deny; Meta Pixel stays consent-gated via
// GTM (no direct pre-consent cookie fire). Loads gtag itself because the GTM
// container is empty (window.gtag would otherwise be undefined and nothing fires).

const GA4 = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID || "G-VSP31JFVVJ";
const ADS = process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION || "AW-18031024663/lDyRCNb0sLocEJe07pVD";

// service -> conversion value (INR). Unknown services fall back to "other".
const VALUE_MAP: Record<string, number> = {
  home_visit: 500,
  teleconsult: 400,
  lab: 200,
  other: 300,
};

declare global {
  interface Window {
    // dataLayer is declared by @next/third-parties; don't redeclare it.
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
  }
}

export function PaidConversionFire() {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    const q = new URLSearchParams(window.location.search);
    const gclid = q.get("gclid");
    if (!gclid) return; // paid Google Ads visitors only
    fired.current = true;

    try {
      const raw = q.get("service") || "other";
      const service = VALUE_MAP[raw] !== undefined ? raw : "other";
      const value = VALUE_MAP[service] ?? 300;
      const ctx = {
        utm_source: q.get("utm_source"),
        utm_medium: q.get("utm_medium"),
        utm_campaign: q.get("utm_campaign"),
        utm_content: q.get("utm_content"),
        utm_term: q.get("utm_term"),
        gclid,
      };

      const dataLayer = (window.dataLayer = window.dataLayer || []);
      const gtag = (...args: unknown[]) => {
        dataLayer.push(args);
      };
      window.gtag = window.gtag || gtag;

      gtag("consent", "default", {
        ad_storage: "denied",
        analytics_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
      dataLayer.push({ event: "whatsapp_click_paid", service, value, currency: "INR", ...ctx });

      if (GA4) {
        if (!document.getElementById("ga4-js")) {
          const s = document.createElement("script");
          s.id = "ga4-js";
          s.async = true;
          s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA4;
          document.head.appendChild(s);
        }
        gtag("js", new Date());
        gtag("config", GA4, { transport_type: "beacon" });
        gtag("event", "whatsapp_click", { service, value, currency: "INR", transport_type: "beacon", ...ctx });
        if (ADS) {
          gtag("event", "conversion", { send_to: ADS, value, currency: "INR", transport_type: "beacon" });
        }
      }

      if (typeof window.fbq === "function") {
        window.fbq("track", "Lead", { service, value, currency: "INR" });
      }

      navigator.sendBeacon(
        "/api/paid-click-log",
        new Blob([JSON.stringify({ service, ...ctx })], { type: "application/json" }),
      );
    } catch {
      // tracking must never break the page
    }
  }, []);

  return null;
}
