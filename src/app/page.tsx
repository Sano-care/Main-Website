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
// Layout per breakpoint:
//   mobile     — AboutBand + 4 services stack inside max-w-[420px] column
//   md (≥768)  — AboutBand + 4 services widen to max-w-[680px], stacked
//   lg (≥1024) — AboutBand full-bleed gradient inside max-w-[1100px];
//                4 services render as a 2x2 grid inside max-w-[1100px]
//                with gap-6
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

          {/* AboutBand — lifted above the service stack in T91 so the
              desktop 2x2 grid reads as one focused unit. Full-bleed at
              lg+ via the band's own internal max-w-[1100px]. */}
          <div className="mx-auto w-full max-w-[420px] md:max-w-[680px] lg:max-w-[1100px] px-0 lg:px-6">
            <SectionReveal>
              <AboutBand />
            </SectionReveal>
          </div>

          {/* 4 services — mobile-first column, widen at md, 2x2 grid at lg.
              `items-start` keeps shorter cards aligned to their grid cell
              top instead of stretching vertically. */}
          <div className="mx-auto w-full max-w-[420px] md:max-w-[680px] lg:max-w-[1100px] px-0 lg:px-6 lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start">
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
        </main>

        <Footer />
      </div>
    </div>
  );
}
