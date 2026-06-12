import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Clock, ShieldCheck, Star, ArrowRight } from "lucide-react";

import { ConversionGtagLoader } from "@/components/ConversionGtagLoader";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { getServiceLabel } from "@/lib/aarogya/labels";
import {
  SERVICE_PAGES,
  SERVICE_PAGE_SLUGS,
  type ServicePageContent,
} from "./serviceContent";
import { BookVisitCta } from "./BookVisitCta";

// Page-scoped WhatsApp click conversion firing — currently only the
// home-nurse SEO page is the Final URL of a live Google Ads campaign
// (`23929771665`, "Sanocare - Home Nursing - Delhi NCR"). On that page,
// WhatsApp CTA clicks fire a Google Ads conversion + Meta Pixel Lead.
// All other service pages render BookVisitCta with default no-fire.
const WHATSAPP_CONVERSION_SLUG = "home-nurse-delhi-ncr";

const SITE_URL = "https://sanocare.in";

// Static export of all four service pages at build time.
export function generateStaticParams() {
  return SERVICE_PAGE_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = SERVICE_PAGES[slug];
  if (!page) return {};

  const url = `${SITE_URL}/services/${page.seoSlug}`;
  return {
    title: page.metaTitle,
    description: page.metaDescription,
    alternates: { canonical: url },
    openGraph: {
      title: page.metaTitle,
      description: page.metaDescription,
      url,
      siteName: "Sanocare",
      locale: "en_IN",
      type: "website",
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: page.h1 }],
    },
    twitter: {
      card: "summary_large_image",
      title: page.metaTitle,
      description: page.metaDescription,
      images: ["/og-image.png"],
    },
  };
}

// ----- Schema builders ------------------------------------------------------

function serviceSchema(page: ServicePageContent) {
  // Teleconsultation reaches all of India; the in-person services are
  // Delhi-NCR local.
  const areaServed =
    page.serviceSlug === "teleconsultation"
      ? { "@type": "Country", name: "India" }
      : { "@type": "City", name: "New Delhi" };

  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: page.schemaServiceName,
    description: page.metaDescription,
    provider: {
      "@type": "MedicalOrganization",
      name: "Sanocare",
      url: SITE_URL,
    },
    areaServed,
    serviceType: page.serviceType,
    url: `${SITE_URL}/services/${page.seoSlug}`,
    offers: {
      "@type": "Offer",
      price: page.price,
      priceCurrency: "INR",
      priceSpecification: {
        "@type": "PriceSpecification",
        price: page.price,
        priceCurrency: "INR",
        valueAddedTaxIncluded: true,
      },
    },
  };
}

function breadcrumbSchema(page: ServicePageContent) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: "Services",
        item: `${SITE_URL}/services`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: page.breadcrumbName,
        item: `${SITE_URL}/services/${page.seoSlug}`,
      },
    ],
  };
}

function faqSchema(page: ServicePageContent) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

// ----- Page -----------------------------------------------------------------

export default async function ServicePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = SERVICE_PAGES[slug];
  if (!page) notFound();

  // Google-Ads classifier-safe pages drop the cross-service grid (it names
  // doctor / teleconsult services) and render the nursing-only footer.
  const classifierSafe = !!page.classifierSafe;

  // T93 — fire WhatsApp click conversion only on the page that the live
  // paid campaign points at. Other service pages stay untouched.
  const fireWhatsAppConversion = page.seoSlug === WHATSAPP_CONVERSION_SLUG;

  const others = SERVICE_PAGE_SLUGS.filter((s) => s !== slug).map(
    (s) => SERVICE_PAGES[s],
  );

  return (
    <>
      <JsonLd data={serviceSchema(page)} />
      <JsonLd data={breadcrumbSchema(page)} />
      <JsonLd data={faqSchema(page)} />

      {/* T93 — gtag.js loader needed by BookVisitCta's WhatsApp click
          conversion event. Mounted only when fireWhatsAppConversion is
          on, so the script is not loaded on the other 3 service pages
          where no conversion will fire. */}
      {fireWhatsAppConversion ? <ConversionGtagLoader /> : null}

      <Navbar />

      <main className="bg-white text-text-main">
        {/* Breadcrumb */}
        <nav
          aria-label="Breadcrumb"
          className="mx-auto max-w-[1100px] px-6 lg:px-12 pt-6 text-sm text-text-secondary"
        >
          <ol className="flex flex-wrap items-center gap-1.5">
            <li>
              <Link href="/" className="hover:text-primary">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href="/services" className="hover:text-primary">
                Services
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="font-medium text-text-main">{page.breadcrumbName}</li>
          </ol>
        </nav>

        {/* 1. Hero */}
        <section className="mx-auto max-w-[1100px] px-6 lg:px-12 pt-8 pb-12">
          <h1 className="font-serif text-4xl lg:text-5xl font-bold leading-tight">
            {page.h1}
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-text-secondary">
            {page.subtitle}
          </p>
          <div className="mt-7">
            <BookVisitCta
              serviceSlug={page.serviceSlug}
              fireWhatsAppConversion={fireWhatsAppConversion}
            />
          </div>
        </section>

        {/* 2. What's included */}
        <section className="border-t border-slate-100 bg-slate-50/60">
          <div className="mx-auto max-w-[1100px] px-6 lg:px-12 py-14">
            <p className="mt-2 text-base leading-relaxed text-text-secondary max-w-3xl">
              {page.intro}
            </p>
            <div className="mt-10 grid gap-8 md:grid-cols-2">
              {page.included.map((block) => (
                <div key={block.heading}>
                  <h2 className="text-lg font-bold">{block.heading}</h2>
                  <p className="mt-2 text-base leading-relaxed text-text-secondary">
                    {block.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 3. Common use cases */}
        <section className="mx-auto max-w-[1100px] px-6 lg:px-12 py-14">
          <h2 className="font-serif text-2xl lg:text-3xl font-bold">
            When to use this service
          </h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {page.useCases.map((uc) => (
              <li key={uc} className="flex items-start gap-3">
                <Check
                  className="mt-1 h-5 w-5 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <span className="text-base text-text-secondary">{uc}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* 4. How it works */}
        <section className="border-t border-slate-100 bg-slate-50/60">
          <div className="mx-auto max-w-[1100px] px-6 lg:px-12 py-14">
            <h2 className="font-serif text-2xl lg:text-3xl font-bold">
              How it works
            </h2>
            <ol className="mt-8 grid gap-6 md:grid-cols-4">
              {page.howItWorks.map((step, i) => (
                <li key={step.title} className="relative">
                  <span className="text-sm font-bold text-primary">
                    Step {i + 1}
                  </span>
                  <h3 className="mt-1 text-base font-bold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 5. Pricing card */}
        <section className="mx-auto max-w-[1100px] px-6 lg:px-12 py-14">
          <div className="rounded-2xl border border-slate-200 p-8 shadow-sm">
            <span className="text-[11px] font-bold uppercase tracking-widest text-text-secondary">
              {getServiceLabel(page.serviceSlug)} · pricing
            </span>
            <p className="mt-3 text-2xl font-bold">{page.pricingNote}</p>
            <p className="mt-2 text-sm text-text-secondary">
              The exact amount is always shown before you confirm — no surprise
              fees, GST-exempt clinical care.
            </p>
            <div className="mt-6">
              <BookVisitCta
                serviceSlug={page.serviceSlug}
                fireWhatsAppConversion={fireWhatsAppConversion}
              />
            </div>
          </div>
        </section>

        {/* 6. FAQ */}
        <section className="border-t border-slate-100 bg-slate-50/60">
          <div className="mx-auto max-w-[1100px] px-6 lg:px-12 py-14">
            <h2 className="font-serif text-2xl lg:text-3xl font-bold">
              Frequently asked questions
            </h2>
            <div className="mt-8 divide-y divide-slate-200">
              {page.faqs.map((f) => (
                <details key={f.q} className="group py-4">
                  <summary className="flex cursor-pointer items-center justify-between gap-4 text-base font-semibold marker:content-none">
                    {f.q}
                    <ArrowRight
                      className="h-5 w-5 shrink-0 text-primary transition-transform group-open:rotate-90"
                      aria-hidden="true"
                    />
                  </summary>
                  <p className="mt-3 text-base leading-relaxed text-text-secondary">
                    {f.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* 7. Trust strip (honest metrics — matches PR #53) */}
        <section className="mx-auto max-w-[1100px] px-6 lg:px-12 py-10">
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm font-medium text-text-secondary">
            <span className="inline-flex items-center gap-1.5 font-semibold text-text-main">
              <Star
                className="h-4 w-4 fill-yellow-400 text-yellow-400"
                aria-hidden="true"
              />
              5.0 on Google
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
              &lt;30 min response
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
              MoHFW 2020 compliant
            </span>
          </div>
        </section>

        {/* 8. Cross-service links — omitted on classifier-safe pages (the
            cards name doctor / teleconsult services Google Ads' healthcare
            classifier flags). */}
        {!classifierSafe && (
          <section className="border-t border-slate-100">
            <div className="mx-auto max-w-[1100px] px-6 lg:px-12 py-14">
              <h2 className="font-serif text-2xl font-bold">
                Our other services
              </h2>
              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                {others.map((o) => (
                  <Link
                    key={o.seoSlug}
                    href={`/services/${o.seoSlug}`}
                    className="group rounded-xl border border-slate-200 p-5 transition-colors hover:border-primary"
                  >
                    <h3 className="text-base font-bold group-hover:text-primary">
                      {getServiceLabel(o.serviceSlug)}
                    </h3>
                    <p className="mt-1.5 text-sm text-text-secondary">
                      {o.subtitle}
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                      Learn more
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      <Footer variant={classifierSafe ? "classifier-safe" : "default"} />
    </>
  );
}
