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
