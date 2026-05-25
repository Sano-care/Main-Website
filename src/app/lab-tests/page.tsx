import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, Truck, ShieldCheck, MapPin } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { QuickCategories } from "./QuickCategories";
import { LabTestsBanner } from "./LabTestsBanner";
import { LabTestSearch } from "@/components/lab/LabTestSearch";
import { LabTestBasket } from "@/components/lab/LabTestBasket";
import { PathcoreCoBrandStrip } from "@/components/PathcoreCoBrandStrip";

export const metadata: Metadata = {
  title: "Lab Tests at Home — Search 1,900+ Tests · Sanocare",
  description:
    "Find the price of any lab test we offer at home in South Delhi. 1,900+ tests across pathology and diagnostics. Free home collection — pay only for the test. Processed by our partner laboratories.",
  alternates: { canonical: "/lab-tests" },
  openGraph: {
    title: "Lab Tests at Home — Search 1,900+ Tests · Sanocare",
    description:
      "Free home collection, pay only for the test. Partner laboratories across South Delhi.",
    url: "https://sanocare.in/lab-tests",
    type: "website",
  },
};

export default function LabTestsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background-light">
      <Navbar />

      <main className="flex-1">
        {/* One-time banner shown only when navigated here from the homepage
            inline form (?from=hero). Wrapped in Suspense per Next.js's
            useSearchParams requirement so the page stays statically renderable. */}
        <Suspense fallback={null}>
          <LabTestsBanner />
        </Suspense>

        {/* Diagnostics co-brand strip — names Pathcore as the processing
            lab. Sits above the hero so the partnership reads first. */}
        <PathcoreCoBrandStrip />

        {/* Hero with search + basket right-rail (desktop). Basket is a bottom
            drawer on mobile, anchored at the bottom of the page. */}
        <section className="relative overflow-hidden bg-gradient-to-b from-primary-50 to-white border-b border-slate-200">
          <div className="absolute inset-0 opacity-30 pointer-events-none bg-dna-pattern" />
          <div className="relative mx-auto max-w-6xl px-6 lg:px-8 py-14 lg:py-20 grid lg:grid-cols-[1fr_360px] gap-8 lg:gap-12 items-start">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-primary transition-colors mb-8"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to home
            </Link>
            <div className="font-mono text-[11px] tracking-widest uppercase text-[color:var(--color-accent-coral-dark)] mb-3">
              Lab tests at home
            </div>
            <h1 className="text-4xl lg:text-5xl font-bold tracking-tight text-text-main mb-4">
              Find the price of any lab test we offer.
            </h1>
            <p className="text-lg text-text-secondary max-w-2xl mb-8">
              Search 1,900+ tests across pathology, biochemistry, oncology, and
              genetics. <strong>Free home collection</strong> — you pay only for
              the test. Reports flow back into your Sanocare record.
            </p>

            <LabTestSearch variant="hero" />

            {/* Trust strip */}
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-text-secondary">
              <span className="inline-flex items-center gap-2">
                <Truck className="w-4 h-4 text-primary" />
                Free home collection across South Delhi
              </span>
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                Processed at our partner laboratories
              </span>
              <span className="inline-flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" />
                Kalkaji · Govindpuri Ext. & expanding
              </span>
            </div>
          </div>

          {/* Right rail: sticky basket panel (desktop only) */}
          <div className="hidden lg:block">
            <LabTestBasket variant="rail" />
          </div>
        </section>

        {/* Mobile: floating bottom drawer for the basket (only renders on <md) */}
        <LabTestBasket variant="drawer" />

        {/* Categories quick-explore */}
        <section className="mx-auto max-w-4xl px-6 lg:px-8 py-12">
          <div className="font-mono text-[11px] tracking-widest uppercase text-primary mb-3">
            Quick categories
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-text-main mb-6">
            Browse by what you&apos;re looking for.
          </h2>
          <QuickCategories />
        </section>

        {/* How collection works */}
        <section className="mx-auto max-w-4xl px-6 lg:px-8 py-12 border-t border-slate-200">
          <div className="font-mono text-[11px] tracking-widest uppercase text-[color:var(--color-accent-coral-dark)] mb-3">
            How home collection works
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-text-main mb-6">
            Free collection. Pay only for the test.
          </h2>
          <ol className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                step: "1",
                title: "Book a test",
                desc: "Search and select your test. Confirm address. ₹0 for the collection visit.",
              },
              {
                step: "2",
                title: "Phlebo arrives",
                desc: "A trained phlebotomist arrives at your home, collects the sample hygienically, and seals it for transport.",
              },
              {
                step: "3",
                title: "Report in your record",
                desc: "Sample is processed at our partner laboratory. Report uploads to your Sanocare record + emailed to you.",
              },
            ].map((s) => (
              <li
                key={s.step}
                className="bg-white border border-slate-200 rounded-2xl p-5"
              >
                <div className="w-7 h-7 rounded-lg bg-[color:var(--color-accent-coral)] text-white font-bold text-sm flex items-center justify-center mb-3">
                  {s.step}
                </div>
                <h3 className="font-semibold text-text-main mb-1">{s.title}</h3>
                <p className="text-sm text-text-secondary">{s.desc}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Compliance band */}
        <section className="mx-auto max-w-4xl px-6 lg:px-8 py-10 border-t border-slate-200">
          <div className="bg-white border border-primary-100 rounded-2xl p-5 lg:p-6">
            <div className="font-mono text-[11px] tracking-widest uppercase text-primary mb-2">
              Partner & compliance
            </div>
            <p className="text-sm text-text-main leading-relaxed">
              Lab samples are processed by our{" "}
              <strong>partner laboratories</strong>. Sample
              collection follows{" "}
              <strong>chain-of-custody protocol</strong> with patient
              identifiers, collection timestamps and tamper-evident seals.
              Reports are uploaded to your Sanocare patient record per{" "}
              <strong>DPDP Act 2023</strong> with explicit consent. Prices shown
              are MRPs as supplied by the partner lab; bulk-test discounts may
              apply on health-check packages — call{" "}
              <a
                href="tel:+919711977782"
                className="text-primary underline"
              >
                +91-97119 77782
              </a>{" "}
              to ask.
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
