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
