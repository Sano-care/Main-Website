import { DNABackground } from "@/components/ui";
import {
  Navbar,
  Hero,
  StatsBar,
  Footer,
  FloatingSidebar,
  TopBanner,
  SanocareAdvantage,
} from "@/components";
import { SectionReveal } from "@/components/marketing/SectionReveal";
import { FloatingWhatsApp } from "@/components/marketing/FloatingWhatsApp";
import { HomeStickyBar } from "@/components/marketing/HomeStickyBar";
import { ServiceSection } from "@/components/marketing/ServiceSection";
import { AboutBand } from "@/components/marketing/AboutBand";
import { SERVICES } from "@/lib/services/catalog";
import { PaidConversionFire } from "@/components/PaidConversionFire";
import { PAGE_CONTAINER } from "@/lib/layout/pageContainer";

// T85 PR2 + T91 — homepage hierarchy. T91 swaps the mobile-first 420px
// column for a desktop-responsive layout, with the AboutBand lifted
// from "between S1 and S2" up to a full-bleed band above the service
// stack so the desktop 2x2 grid reads as one focused choose-your-
// service unit instead of being interrupted between S1 and S2.
//
// Render order (all viewports):
//   1. Navbar
//   2. Hero (informational only)
//   3. AboutBand (brand-context blue band — moved here in T91)
//   4. Service 1: Home-Visit
//   5. Service 2: Teleconsultation
//   6. Service 3: Lab Tests at Home
//   7. Service 4: Medic at Home
//   8. StatsBar (Numbers band)
//   9. SanocareAdvantage
//  10. Footer
//
// Layout per breakpoint (2026-08-15 full-width pass):
//   Every section — hero, carousel, About, the 4 services, numbers,
//   advantage, footer — now shares one width container (PAGE_CONTAINER,
//   ≈92vw capped at 1720px, px-6 / lg:px-10). One change, used everywhere.
//   mobile — AboutBand + 4 services stack full-width inside the container
//   lg     — 4 services render as a 2-col grid inside the same container
//            with gap-6; `items-start` keeps shorter cards top-aligned
//
// Booking entry points across the homepage:
//   - 4 coral CTAs inside ServiceSections
//   - HomeStickyBar (mobile sticky)
//   - FloatingWhatsApp (mobile pill)
//   - Navbar Book a Visit button

// NEXT_PUBLIC_SHOW_PULSE_BETA_BANNER gates the Pulse closed-beta TopBanner.
// Defaults hidden (false / unset); flip to "true" to surface it.
const SHOW_PULSE_BANNER =
  process.env.NEXT_PUBLIC_SHOW_PULSE_BETA_BANNER === "true";

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      {/* Paid Google Ads conversion fire (gclid-gated; no-op for organic) */}
      <PaidConversionFire />

      {/* Background */}
      <DNABackground />

      {/* Floating affordances */}
      <FloatingSidebar />
      <FloatingWhatsApp />
      <HomeStickyBar />

      {/* Main Content */}
      <div className="relative z-10 flex flex-col min-h-screen">
        <Navbar />
        {SHOW_PULSE_BANNER && <TopBanner />}

        <main className="flex flex-col flex-1 pb-20 lg:pb-0">
          {/* Hero — informational only (CTAs + QuickBookCard removed in Hero.tsx) */}
          <SectionReveal>
            <Hero />
          </SectionReveal>

          {/* AboutBand — full-width brand band directly below the hero
              carousel, inside the shared container. */}
          <div className={PAGE_CONTAINER}>
            <SectionReveal>
              <AboutBand />
            </SectionReveal>
          </div>

          {/* 4 services — full-width stack on mobile, 2-col grid at lg, all
              inside the shared container. `items-start` keeps shorter cards
              aligned to their grid cell top instead of stretching. */}
          <div className={`${PAGE_CONTAINER} lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start`}>
            {SERVICES.map((config, index) => (
              <SectionReveal key={config.slug}>
                <ServiceSection
                  config={config}
                  index={index}
                  total={SERVICES.length}
                />
              </SectionReveal>
            ))}
          </div>

          {/* Numbers band */}
          <SectionReveal>
            <StatsBar />
          </SectionReveal>

          {/* The Sanocare Advantage */}
          <SectionReveal>
            <SanocareAdvantage />
          </SectionReveal>

          {/* The app-download / launch countdown now lives in the hero-right
              carousel as its frozen lead slide (HeroAppSlide), so the former
              mid-page app band was removed. */}
        </main>

        <Footer wide />
      </div>
    </div>
  );
}
