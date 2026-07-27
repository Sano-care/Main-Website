import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import { GoogleTagManager } from "@next/third-parties/google";
import { headers } from "next/headers";
import { CmsPreloadProvider } from "@/components/providers/CmsPreloadProvider";
import { getCmsPreloadSnapshot } from "@/services/cms/CmsContentServerService";
import { ConsentDefaultScript } from "@/components/consent/ConsentDefaultScript";
import { GclidCapture } from "@/components/marketing/GclidCapture";
import { ConsentRoot } from "@/components/consent/ConsentRoot";
import { PHONE_TEL, SUPPORT_EMAIL } from "@/lib/contact";
import "./globals.css";

// GTM container ID. Public client-side identifier — safe to commit
// (not a secret, the value is visible in every page's <script> tag
// anyway). The container is currently empty: GTM_T6K94WMC loads on
// every pageview but no GA4 / Meta / other tags fire inside it yet,
// so no tracking happens until marketing publishes inside the GTM UI.
//
// DPDP gating note: a consent banner (Consent Mode v2) MUST land
// before any tracking tag inside the container goes live —
// otherwise we collect analytics without explicit consent, which is
// a DPDP Act 2023 exposure. The banner is a separate ticket
// (Task #42 in the founder's progress list); this PR is just the
// loader.
const GTM_CONTAINER_ID = "GTM-T6K94WMC";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["500"],
});

export const metadata: Metadata = {
  title: {
    default: "Sanocare — Trusted Healthcare at Home in 30 mins. South Delhi.",
    template: "%s | Sanocare",
  },
  description:
    "GNM / B.Sc Nursing-qualified medics arrive in under 30 minutes, supervised in real time by an MBBS doctor on live video. Doctor's written advice under MoHFW 2020. Starting from ₹499. Now serving Kalkaji & Govindpuri Extension.",
  keywords: [
    "nurse home visit Delhi",
    "doctor home visit",
    "homecare South Delhi",
    "GNM nurse home visit",
    "MBBS teleconsultation",
    "nursing care at home",
    "lab test at home Delhi",
    "Sanocare",
    "Sanocare Pulse",
    "healthcare at doorstep",
    "telemedicine MoHFW 2020",
    "paramedic service Delhi",
    "home visit Kalkaji",
    "home visit Govindpuri",
  ],
  authors: [{ name: "Sanocare Tech Innovations Pvt. Ltd." }],
  creator: "Sanocare",
  publisher: "Sanocare Tech Innovations Pvt. Ltd.",
  formatDetection: { email: false, address: false, telephone: false },
  metadataBase: new URL("https://sanocare.in"),
  alternates: { canonical: "/" },
  openGraph: {
    title: "Sanocare — Trusted Healthcare at Home in 30 mins.",
    description:
      "GNM / B.Sc Nursing-qualified medics arrive in under 30 minutes, supervised in real time by an MBBS doctor on live video. Starting from ₹499. South Delhi.",
    url: "https://sanocare.in",
    siteName: "Sanocare",
    locale: "en_IN",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Sanocare — home healthcare across South Delhi",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sanocare — Trusted Healthcare at Home in 30 mins.",
    description:
      "Trusted healthcare at home in 30 minutes — GNM medics supervised by an MBBS doctor on live video. From ₹499.",
    images: ["/og-image.png"],
    creator: "@sanocare",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  // Favicon/app icons are served via the App Router file convention —
  // src/app/icon.png + src/app/apple-icon.png (the square Sanocare brand
  // mark). Next.js auto-injects the <link rel="icon"> / apple-touch-icon
  // tags, so no `icons` metadata override here (it would take precedence
  // over the convention files). logo.svg is the wordmark — kept only as
  // the schema `logo` below, not as the favicon.
  manifest: "/manifest.json",
  verification: {
    other: { "facebook-domain-verification": "kfszus13qiekuol0cdt8784x8bdgb6" },
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": ["MedicalBusiness", "LocalBusiness"],
  name: "Sanocare",
  legalName: "Sanocare Tech Innovations Private Limited",
  url: "https://sanocare.in",
  logo: "https://sanocare.in/logo.svg",
  image: "https://sanocare.in/og-image.png",
  telephone: PHONE_TEL,
  email: SUPPORT_EMAIL,
  description:
    "Home healthcare in South Delhi. A GNM / B.Sc Nursing-qualified medic arrives at your home, supervised in real time by an MBBS doctor on live video, who shares the doctor's written advice per MoHFW Telemedicine Practice Guidelines 2020.",
  // Visible homepage pricing spans ₹199 (home nursing) to full lab
  // checkups (~₹4,500). Explicit range > the opaque "₹₹" band.
  priceRange: "₹199 - ₹4500",
  address: {
    "@type": "PostalAddress",
    streetAddress: "1666/B2, 3rd Floor, Gali 2, Govindpuri Extension, Kalkaji",
    addressLocality: "New Delhi",
    addressRegion: "DL",
    postalCode: "110019",
    addressCountry: "IN",
  },
  // Approximate Kalkaji coordinates (~200m); founder to refine with an
  // exact office pin in a follow-up. Acceptable offset, no penalty risk.
  geo: {
    "@type": "GeoCoordinates",
    latitude: 28.534,
    longitude: 77.258,
  },
  areaServed: [
    { "@type": "City", name: "New Delhi" },
    { "@type": "AdministrativeArea", name: "Delhi NCR" },
    { "@type": "Place", name: "Kalkaji, New Delhi" },
    { "@type": "Place", name: "Govindpuri Extension, New Delhi" },
  ],
  // Standard hours are 9 AM-9 PM (KB: never promise 24/7). The previous
  // "Mo-Su 00:00-23:59" wrongly declared round-the-clock availability —
  // corrected here to the real service window via OpeningHoursSpecification
  // (the structured form Google reads for "open now" rich treatment).
  openingHoursSpecification: {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ],
    opens: "09:00",
    closes: "21:00",
  },
  medicalSpecialty: [
    "PrimaryCare",
    "Geriatric",
    "Pediatric",
    "Nursing",
    "LaboratoryScience",
  ],
  // aggregateRating intentionally omitted: the only verifiable source is
  // the Google Business Profile (currently 5.0★ from 6 reviews). Declaring
  // a rating in schema with such a thin, single-source count risks a
  // Google structured-data manual action and overstates social proof.
  // Re-add honestly once the GBP review count reaches ~25+.
  identifier: {
    "@type": "PropertyValue",
    propertyID: "CIN",
    value: "U86904DL2025PTC446725",
  },
  sameAs: [
    "https://www.instagram.com/sanocare.in/",
    "https://www.linkedin.com/company/sanocare-tech-innovations-private-limited/",
    "https://www.facebook.com/profile.php?id=61587546362097",
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cmsSnapshot = await getCmsPreloadSnapshot();
  // Classifier-safe ad landing pages (/talk and future siblings) must NOT
  // emit the MedicalBusiness JSON-LD — Google's healthcare classifier scans
  // the whole DOM at the ad destination, JSON-LD included. The pathname
  // header is set by middleware.ts for matched paths only, so this check
  // is a no-op on every other route. See src/app/(thin)/layout.tsx.
  const hdrs = await headers();
  const pathname = hdrs.get("x-pathname") ?? "";
  const isThinRoute = pathname.startsWith("/talk");

  return (
    <html lang="en">
      {/* Consent Mode v2 default-deny — MUST execute before the GTM
          container's inline script. strategy="beforeInteractive" puts
          this in <head> before the body's hydration scripts so Consent
          Mode v2's wait_for_update gate has the default state set
          before any tag inside the container has a chance to evaluate.
          See src/components/consent/ConsentDefaultScript.tsx for the
          full reasoning. M033 + this script + ConsentRoot together
          satisfy DPDP Act 2023 for sanocare.in. */}
      <ConsentDefaultScript />
      {/* GoogleTagManager injects the <head> script + <body> noscript
          iframe automatically. Placed at the top level so it covers
          every route (marketing, /ops, /doctor, patient flows). The
          /ops + /doctor routes are robots-noindex'd so analytics
          metrics from those views don't pollute marketing dashboards
          once tags are configured — handled at marketing-config time,
          not here. */}
      <GoogleTagManager gtmId={GTM_CONTAINER_ID} />
      <head>
        <meta name="theme-color" content="#2B81FF" />
        <meta name="geo.region" content="IN-DL" />
        <meta name="geo.placename" content="New Delhi" />
        {!isThinRoute && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
          />
        )}
      </head>
      <body
        suppressHydrationWarning
        className={`${inter.variable} ${ibmPlexMono.variable} font-sans antialiased`}
      >
        <CmsPreloadProvider snapshot={cmsSnapshot}>{children}</CmsPreloadProvider>
        {/* Capture the Google Ads click id first-party on ANY inbound landing
            and mint the short WhatsApp ref token once. Renders nothing; the
            token is what carries ad attribution across the WhatsApp handoff so
            paid bookings can be uploaded to `whatsapp_click_paid`. */}
        <GclidCapture />
        {/* DPDP cookie consent flow. Mounts globally so the footer-link
            reopen event listener is always armed, but the banner's
            auto-show is suppressed on /c/, /doctor/, /ops/, /rx/,
            /portal/ — see ConsentRoot.tsx for the route-aware logic. */}
        <ConsentRoot />
        {/*
         * Razorpay Checkout JS is intentionally NOT loaded here.
         *
         * It used to live in this root layout, which meant every page
         * (including the doctor portal at /doctor, the ops dashboard,
         * and every static marketing page) loaded ~100 v2-entry-*.js
         * chunks totalling roughly 7.9 MB of needless fetches per
         * page-load. Razorpay is only invoked from the patient checkout
         * flow (BookingModal — Hero + lab-tests booking) and the
         * report-unlock page (ReportPaymentClient at /reports/[token]),
         * so the <Script> tag now lives inside those two components.
         *
         * Next.js's <Script> dedupes by `src`, so even if both surfaces
         * mount in the same session (rare but possible) the JS loads
         * exactly once.
         */}
      </body>
    </html>
  );
}
