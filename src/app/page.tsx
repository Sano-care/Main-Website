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

// T85 PR2 — homepage rewired to the brief's 8-section hierarchy:
//
//   1. Navbar
//   2. Hero (informational only — CTAs stripped in Hero.tsx itself)
//   3. Service 1: Home-Visit
//   4. AboutBand (blue band, between Service 1 and Service 2)
//   5. Service 2: Teleconsultation
//   6. Service 3: Lab Tests at Home
//   7. Service 4: Medic at Home
//   8. StatsBar (Numbers band — copy locked to T85 brief Section 5)
//   9. SanocareAdvantage
//  10. Footer
//
// Booking entry points across the homepage:
//   - 4 coral CTAs inside ServiceSections (PR4 wires the modal flow)
//   - HomeStickyBar (mobile sticky)
//   - FloatingWhatsApp (mobile pill)
//   - Navbar Book a Visit button
//
// Removed from the homepage tree in PR2 (vs T61) — file-level cleanup
// happens in PR5 after a full grep for other callers:
//   - 5 × BookingCTASection strips
//   - LabTestSearchSection (Lab is now Service 3 card; the component
//     still serves `/lab-tests` page)
//   - Testimonials, Features, Journey, Insights, Accreditations
//   - Hero CTA buttons + QuickBookCard (handled inside Hero.tsx)
//
// The 4 ServiceSections + the AboutBand all render inside a 420px
// mobile-first column. StatsBar + SanocareAdvantage are full-bleed
// bands with their own internal max-widths.

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

          {/* Service stack — mobile-first 420px column. Brief order:
              Service 1 → AboutBand → Service 2 → Service 3 → Service 4. */}
          <div className="mx-auto max-w-[420px] w-full">
            {/* Service 1: Home-Visit */}
            <SectionReveal>
              <ServiceSection
                config={SERVICES[0]}
                index={0}
                total={SERVICES.length}
              />
            </SectionReveal>

            {/* About Sanocare blue band */}
            <SectionReveal>
              <AboutBand />
            </SectionReveal>

            {/* Services 2–4: Teleconsultation, Lab Tests, Medic at Home */}
            {SERVICES.slice(1).map((config, i) => {
              const index = i + 1;
              return (
                <SectionReveal key={config.slug}>
                  <ServiceSection
                    config={config}
                    index={index}
                    total={SERVICES.length}
                  />
                </SectionReveal>
              );
            })}
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
