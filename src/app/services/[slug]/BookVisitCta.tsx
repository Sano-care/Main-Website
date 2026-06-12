"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";

import { useBookingFlow } from "@/hooks/useBookingFlow";
import { WHATSAPP_DEEPLINK } from "@/lib/contact";
import type { ServiceSlug } from "@/lib/services/catalog";

// Interactive booking CTA for the SEO service pages. The page itself stays a
// server component (for metadata + indexable schema); this small client island
// drives the booking flow. The BookingModal / BookingGate are mounted by
// <Navbar /> on the same page, and useBookingFlow is Zustand-backed (no
// provider needed), so requestBooking* opens the gate/modal from here.
//
// `fireWhatsAppConversion` (T93, 2026-06-12):
//   When `true`, the WhatsApp CTA click fires a Google Ads conversion event
//   + Meta Pixel Lead event. SessionStorage gate dedupes — the same browser
//   session refreshing or re-clicking does not double-count, regardless of
//   how many BookVisitCta instances render on the page (currently 2 on
//   home-nurse: header + footer).
//
//   The flag is page-scoped, NOT slug-scoped: only the home-nurse render
//   path passes `true` (page.tsx), because the only paid campaign live today
//   is `23929771665` Google Ads "Sanocare - Home Nursing - Delhi NCR" whose
//   Final URL is /services/home-nurse-delhi-ncr. The other 3 service pages
//   pass the default `false` so they do not pollute the optimisation signal.
//
//   gtag must be loaded for the conversion fire to land — done by mounting
//   <ConversionGtagLoader /> on the same page (see page.tsx). The handler
//   itself defensively guards `typeof window.gtag === "function"` so it
//   silently no-ops if the loader hasn't mounted, never throws, never
//   blocks the WhatsApp link from opening.

const GOOGLE_ADS_WHATSAPP_CONVERSION_ID =
  process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION ||
  "AW-18031024663/lDyRCNb0sLocEJe07pVD";
const WHATSAPP_LEAD_VALUE = 199;
const SESSION_KEY = "whatsapp_click_conversion_fired";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
  }
}

function fireWhatsAppConversionEvent() {
  if (typeof window === "undefined") return;
  try {
    if (window.sessionStorage.getItem(SESSION_KEY) === "1") return;

    if (typeof window.gtag === "function") {
      window.gtag("event", "conversion", {
        send_to: GOOGLE_ADS_WHATSAPP_CONVERSION_ID,
        value: WHATSAPP_LEAD_VALUE,
        currency: "INR",
        transport_type: "beacon",
      });
    }

    if (typeof window.fbq === "function") {
      window.fbq("track", "Lead", {
        content_name: "home_nurse_whatsapp",
        content_category: "home_healthcare",
        value: WHATSAPP_LEAD_VALUE,
        currency: "INR",
      });
    }

    window.sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // Tracking must never break the page. The WhatsApp link still opens
    // because navigation happens via target="_blank" regardless.
  }
}

export function BookVisitCta({
  serviceSlug,
  className = "",
  fireWhatsAppConversion = false,
}: {
  serviceSlug: ServiceSlug;
  className?: string;
  fireWhatsAppConversion?: boolean;
}) {
  const { requestBookingForService, requestBookingForLab } = useBookingFlow();

  const onBook = () =>
    serviceSlug === "lab-tests"
      ? requestBookingForLab()
      : requestBookingForService(serviceSlug);

  const onWhatsApp = fireWhatsAppConversion
    ? fireWhatsAppConversionEvent
    : undefined;

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <button
        type="button"
        onClick={onBook}
        className="inline-flex items-center justify-center rounded-full bg-primary px-7 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
      >
        Book a visit
      </button>
      <Link
        href={WHATSAPP_DEEPLINK}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onWhatsApp}
        className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-6 py-3 text-base font-semibold text-text-main transition-colors hover:border-primary hover:text-primary"
      >
        <MessageCircle className="h-5 w-5" aria-hidden="true" />
        WhatsApp us
      </Link>
    </div>
  );
}
