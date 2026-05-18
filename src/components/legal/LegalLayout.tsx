import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { ArrowLeft } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import type { LegalDocument } from "@/constants/cms-content";

interface LegalLayoutProps {
  doc: LegalDocument;
}

/**
 * Shared layout for the four legal pages — /privacy, /terms, /refund, /emergency.
 * Renders a clean, readable long-form page with a fixed top header (Navbar),
 * a hero block with title + subtitle + dates, the markdown body, and the
 * site Footer.
 *
 * The body comes from src/constants/cms/legal.ts as markdown strings and is
 * rendered with react-markdown. No HTML in the source — keeps the legal text
 * safe and portable.
 */
export function LegalLayout({ doc }: LegalLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background-light">
      <Navbar />

      <main className="flex-1">
        {/* Hero strip */}
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-3xl px-6 lg:px-8 py-14 lg:py-20">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-primary transition-colors mb-8"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to home
            </Link>
            <div className="font-mono text-[11px] tracking-widest uppercase text-primary mb-3">
              Legal · Sanocare Tech Innovations Pvt. Ltd.
            </div>
            <h1 className="text-4xl lg:text-5xl font-bold tracking-tight text-text-main mb-4">
              {doc.title}
            </h1>
            <p className="text-lg text-text-secondary max-w-2xl">
              {doc.subtitle}
            </p>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs font-mono text-text-secondary">
              <span>
                <strong className="text-text-main">Last updated:</strong>{" "}
                {doc.lastUpdated}
              </span>
              <span>
                <strong className="text-text-main">Effective:</strong>{" "}
                {doc.effective}
              </span>
            </div>
          </div>
        </section>

        {/* Body */}
        <article className="mx-auto max-w-3xl px-6 lg:px-8 py-12 lg:py-16 prose-legal">
          <ReactMarkdown
            components={{
              h2: ({ children }) => (
                <h2 className="mt-12 mb-4 text-2xl font-bold tracking-tight text-text-main first:mt-0">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="mt-8 mb-3 text-lg font-semibold text-text-main">
                  {children}
                </h3>
              ),
              p: ({ children }) => (
                <p className="my-4 text-base leading-relaxed text-text-main">
                  {children}
                </p>
              ),
              ul: ({ children }) => (
                <ul className="my-4 ml-6 list-disc space-y-2 text-base text-text-main">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="my-4 ml-6 list-decimal space-y-2 text-base text-text-main">
                  {children}
                </ol>
              ),
              li: ({ children }) => (
                <li className="leading-relaxed">{children}</li>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-text-main">
                  {children}
                </strong>
              ),
              a: ({ children, href }) => (
                <a
                  href={href}
                  className="text-primary underline hover:text-primary-dark"
                >
                  {children}
                </a>
              ),
              table: ({ children }) => (
                <div className="my-6 overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-sm">{children}</table>
                </div>
              ),
              thead: ({ children }) => (
                <thead className="bg-slate-50 border-b border-slate-200">
                  {children}
                </thead>
              ),
              tbody: ({ children }) => (
                <tbody className="divide-y divide-slate-100">{children}</tbody>
              ),
              th: ({ children }) => (
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="px-4 py-3 align-top text-text-main">
                  {children}
                </td>
              ),
              blockquote: ({ children }) => (
                <blockquote className="my-6 border-l-4 border-primary bg-primary-50 px-5 py-3 text-text-main">
                  {children}
                </blockquote>
              ),
              code: ({ children }) => (
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
                  {children}
                </code>
              ),
            }}
          >
            {doc.body}
          </ReactMarkdown>

          {/* Contact strip at the end of every doc */}
          <div className="mt-16 rounded-2xl border border-slate-200 bg-white p-6 lg:p-8">
            <div className="font-mono text-[11px] tracking-widest uppercase text-primary mb-3">
              Questions or grievances
            </div>
            <p className="text-base text-text-main mb-4">
              Write to our <strong>Grievance Officer, Shashwat Arora</strong>{" "}
              at{" "}
              <a
                href="mailto:contact@sanocare.in"
                className="text-primary underline"
              >
                contact@sanocare.in
              </a>{" "}
              or call{" "}
              <a
                href="tel:+919711977782"
                className="text-primary underline"
              >
                +91-97119 77782
              </a>
              . We respond within 30 days as required under the DPDP Act 2023.
            </p>
            <p className="text-sm text-text-secondary">
              Sanocare Tech Innovations Private Limited · CIN
              U86904DL2025PTC446725 · 1666/B2, 3rd Floor, Gali 2, Govindpuri
              Extension, Kalkaji, New Delhi — 110019
            </p>
          </div>

          {/* Cross-links to sibling legal docs */}
          <nav className="mt-10 flex flex-wrap gap-3 text-sm">
            {(["privacy", "terms", "refund", "emergency"] as const)
              .filter((slug) => slug !== doc.slug)
              .map((slug) => (
                <Link
                  key={slug}
                  href={`/${slug}`}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-text-main hover:border-primary hover:text-primary transition-colors"
                >
                  {slug === "privacy" && "Privacy Policy →"}
                  {slug === "terms" && "Terms of Service →"}
                  {slug === "refund" && "Refund Policy →"}
                  {slug === "emergency" && "Emergency Disclaimer →"}
                </Link>
              ))}
          </nav>
        </article>
      </main>

      <Footer />
    </div>
  );
}
