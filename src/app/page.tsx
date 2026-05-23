import { DNABackground } from "@/components/ui";
import {
  Navbar,
  Hero,
  HomeGalleryBanner,
  StatsBar,
  Features,
  Journey,
  Testimonials,
  Insights,
  Accreditations,
  Footer,
  MobileStickyBar,
  FloatingSidebar,
  TopBanner,
  SanocareAdvantage,
} from "@/components";
import { LabTestSearchSection } from "@/components/lab/LabTestSearchSection";

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      {/* Background */}
      <DNABackground />

      {/* Floating Elements */}
      <FloatingSidebar />
      <MobileStickyBar />

      {/* Main Content */}
      <div className="relative z-10 flex flex-col min-h-screen">
        <Navbar />
        <TopBanner />

        <main className="flex flex-col flex-1 pb-20 lg:pb-0">
          {/* Phase 1 gallery banner — sits above the existing hero, never
              replacing it. Phase 2 will move the slide list from a
              hardcoded array into a DB-backed fetch, edited from /ops. */}
          <HomeGalleryBanner />
          <Hero />
          {/* Lab test search — immediately after hero so visitors with a known
              test in mind find it without scrolling further. Loads catalog
              lazily on first interaction. */}
          <LabTestSearchSection />
          <StatsBar />
          <SanocareAdvantage />
          <Testimonials />
          <Features />
          <Journey />
          <Insights />
          <Accreditations />
        </main>

        <Footer />
      </div>
    </div>
  );
}
