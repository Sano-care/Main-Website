"use client";

import { useEffect, useRef } from "react";

// Public client-side IDs (same as /wa; env overrides via NEXT_PUBLIC_*).
const GA4 = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID || "G-VSP31JFVVJ";
const ADS = process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION || "AW-18031024663/lDyRCNb0sLocEJe07pVD";

declare global {
  interface Window {
    // dataLayer is already declared by @next/third-parties; don't redeclare it.
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
  }
}

const BLUE = "#2B81FF";
const INK = "#0F172A";

export interface BookLandingProps {
  /** service_intent slug for attribution. */
  service: string;
  /** Conversion value (INR) reported to GA4 + Ads. */
  value: number;
  hero: string;
  subhead: string;
  bullets: string[];
  /** Full wa.me URL with pre-filled text (opens on button click). */
  waUrl: string;
}

export function BookLanding({ service, value, hero, subhead, bullets, waUrl }: BookLandingProps) {
  const fired = useRef(false);

  useEffect(() => {
    // Fire the conversion ONCE on arrival (the conversion model counts every
    // paid click as a lead — not just button-clickers). Ref guard avoids the
    // React-dev double-invoke.
    if (fired.current) return;
    fired.current = true;

    try {
      const q = new URLSearchParams(window.location.search);
      const ctx = {
        utm_source: q.get("utm_source"),
        utm_medium: q.get("utm_medium"),
        utm_campaign: q.get("utm_campaign"),
        utm_content: q.get("utm_content"),
        utm_term: q.get("utm_term"),
        gclid: q.get("gclid"),
      };

      const dataLayer = (window.dataLayer = window.dataLayer || []);
      const gtag = (...args: unknown[]) => {
        dataLayer.push(args);
      };
      window.gtag = window.gtag || gtag;

      // Consent Mode v2 default-deny — GA4 + Ads send cookieless modelling
      // pings (same healthcare DPDP posture as /wa).
      gtag("consent", "default", {
        ad_storage: "denied",
        analytics_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });

      // dataLayer event for any consent-gated GTM tags (incl. the Meta Pixel).
      dataLayer.push({
        event: "whatsapp_click_paid",
        service,
        value,
        currency: "INR",
        ...ctx,
      });

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
        gtag("event", "whatsapp_click", {
          service,
          value,
          currency: "INR",
          transport_type: "beacon",
          ...ctx,
        });
        if (ADS) {
          gtag("event", "conversion", {
            send_to: ADS,
            value,
            currency: "INR",
            transport_type: "beacon",
          });
        }
      }

      // Meta Pixel: fire ONLY if a consent-gated GTM Pixel tag already defined
      // fbq — we do NOT load a cookie-setting Pixel here pre-consent (DPDP,
      // consistent with /wa). The dataLayer event above is the integration point.
      if (typeof window.fbq === "function") {
        window.fbq("track", "Lead", { service, value, currency: "INR" });
      }

      // Server log (cookieless source of truth) — sendBeacon survives navigation.
      const payload = JSON.stringify({ service, ...ctx });
      navigator.sendBeacon(
        "/api/paid-click-log",
        new Blob([payload], { type: "application/json" }),
      );
    } catch {
      // tracking must never break the page
    }
  }, [service, value]);

  return (
    <main
      style={{ color: INK }}
      className="mx-auto flex min-h-screen max-w-xl flex-col px-6 py-12 font-sans"
    >
      <header className="flex items-center gap-2">
        <span className="text-lg font-semibold tracking-tight" style={{ color: BLUE }}>
          Sanocare
        </span>
      </header>

      <section className="mt-12 flex-1">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          {hero}
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-slate-600">{subhead}</p>

        <ul className="mt-8 space-y-3">
          {bullets.map((b) => (
            <li key={b} className="flex gap-3 text-base leading-relaxed text-slate-700">
              <span aria-hidden className="mt-1 h-2 w-2 flex-none rounded-full" style={{ background: BLUE }} />
              <span>{b}</span>
            </li>
          ))}
        </ul>

        <a
          href={waUrl}
          className="mt-10 inline-flex w-full items-center justify-center rounded-xl px-6 py-4 text-base font-semibold text-white transition-opacity hover:opacity-90 sm:w-auto"
          style={{ background: BLUE }}
        >
          Book on WhatsApp
        </a>
        <p className="mt-3 text-sm text-slate-500">
          Opens a WhatsApp chat with our care team. No payment on this page.
        </p>
      </section>

      <footer className="mt-16 border-t border-slate-200 pt-6 text-xs leading-relaxed text-slate-500">
        Sanocare Tech Innovations Private Limited · CIN U86904DL2025PTC446725 ·{" "}
        <a href="https://sanocare.in/privacy" className="underline">
          Privacy
        </a>
      </footer>
    </main>
  );
}
