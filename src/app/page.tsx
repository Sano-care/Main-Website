import { DNABackground } from "@/components/ui";
import {
  Navbar,
  Hero,
  StatsBar,
  Features,
  Journey,
  Testimonials,
  Insights,
  Accreditations,
  Footer,
  FloatingSidebar,
  TopBanner,
  SanocareAdvantage,
} from "@/components";
import { LabTestSearchSection } from "@/components/lab/LabTestSearchSection";
import { SectionReveal } from "@/components/marketing/SectionReveal";
import { FloatingWhatsApp } from "@/components/marketing/FloatingWhatsApp";
import { BookingCTASection } from "@/components/marketing/BookingCTASection";
import { HomeStickyBar } from "@/components/marketing/HomeStickyBar";

// T61 mobile-first homepage. Each major section is wrapped in SectionReveal
// (scroll-triggered fade/slide-up, reduced-motion safe) and the booking-density
// sweep drops a BookingCTASection after the patient-decision sections, each with
// section-matched copy. The sticky bottom bar + floating WhatsApp keep a booking
// affordance reachable from any scroll position.
//
// Note: the full-screen MobileMenu is mounted from Navbar (outside its <header>)
// rather than here — see Navbar.tsx for the backdrop-blur containing-block
// rationale; that keeps the booking trigger + menu state co-located.

// NEXT_PUBLIC_SHOW_PULSE_BETA_BANNER gates the Pulse closed-beta TopBanner.
// Defaults hidden (false / unset); flip to "true" to surface it.
const SHOW_PULSE_BANNER =
  process.env.NEXT_PUBLIC_SHOW_PULSE_BETA_BANNER === "true";

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
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
          <SectionReveal>
            <Hero />
          </SectionReveal>
          <BookingCTASection
            headline="Ready to book?"
            subline="Pick a service — ₹249 confirms your visit."
          />

          <SectionReveal>
            <LabTestSearchSection />
          </SectionReveal>
          <BookingCTASection
            headline="Need this test?"
            subline="Book free home collection at a time that suits you."
            ctaLabel="Book home collection"
          />

          <SectionReveal>
            <StatsBar />
          </SectionReveal>
          <BookingCTASection
            headline="Join 1,000+ families"
            subline="Trusted, MoHFW-2020-compliant care at home."
          />

          <SectionReveal>
            <SanocareAdvantage />
          </SectionReveal>

          <SectionReveal>
            <Testimonials />
          </SectionReveal>

          <SectionReveal>
            <Features />
          </SectionReveal>
          <BookingCTASection
            headline="Book one of these"
            subline="Pick the service you need — we'll handle the rest."
          />

          <SectionReveal>
            <Journey />
          </SectionReveal>
          <BookingCTASection
            headline="Start your visit in 60 seconds"
            subline="Two fields and a callback — that's all it takes."
          />

          <SectionReveal>
            <Insights />
          </SectionReveal>

          <SectionReveal>
            <Accreditations />
          </SectionReveal>

          <BookingCTASection
            headline="Ready when you are"
            subline="Book a visit, or talk to us on WhatsApp."
          />
        </main>

        <Footer />
      </div>
    </div>
  );
}
