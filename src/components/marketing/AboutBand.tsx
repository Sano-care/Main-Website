// T85 — "About Sanocare" blue band, slotted on the homepage between
// Service 1 (Home-Visit) and Service 2 (Teleconsultation).
//
// Copy is verbatim from the founder-approved T85 brief Section 4. Do
// not paraphrase — every word, every period, every hyphen here was
// chosen deliberately:
//
//   eyebrow — "About Sanocare" (11px, uppercase, white 85% opacity)
//   H2      — "Built on real medical practice — not chatbots."
//   body    — three short clauses about MBBS review, MoHFW 2020,
//             DPDP compliance + GST-exempt clinical care.
//   pill    — coral, label "Read more →", links to /about.
//
// Visual rules per brief:
//   container — linear gradient 135deg from #2B81FF (brand blue) to
//               #1647A1 (deep blue), white text, 28px / 20px padding.
//   pill      — coral fill with the standard accent-coral var, white
//               text, 12px radius, soft coral glow.
//
// The container intentionally has no max-width inside the component —
// it inherits its width from page.tsx's mobile-first 420px column so
// the band sits flush with the surrounding ServiceSection cards.
//
// `prefers-reduced-motion` is honoured via motion-reduce:transition-none
// on the pill hover; the band itself does not animate on entry — the
// parent SectionReveal in page.tsx handles that.

import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function AboutBand() {
  return (
    <section
      aria-labelledby="about-sanocare-heading"
      className="text-white px-5 py-7 rounded-[14px] my-3"
      style={{
        background:
          "linear-gradient(135deg, #2B81FF 0%, #1647A1 100%)",
      }}
    >
      {/* Eyebrow */}
      <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-white/85 mb-[10px]">
        About Sanocare
      </p>

      {/* H2 */}
      <h2
        id="about-sanocare-heading"
        className="text-[22px] font-bold tracking-[-0.4px] leading-[1.2] mb-3"
      >
        Built on real medical practice &mdash; not chatbots.
      </h2>

      {/* Body */}
      <p className="text-[13.5px] leading-[1.65] opacity-[0.92] mb-4">
        Every visit reviewed live by a registered MBBS doctor. Every
        prescription signed under MoHFW Telemedicine Practice Guidelines
        2020. DPDP-compliant patient data, GST-exempt clinical care.
      </p>

      {/* Read more pill — coral, white text, soft coral glow */}
      <Link
        href="/about"
        className="inline-flex items-center gap-1.5 bg-[color:var(--color-accent-coral)] text-white text-[13.5px] font-semibold px-[18px] py-[10px] rounded-[12px] transition-transform duration-100 active:scale-[0.985] motion-reduce:transition-none"
        style={{
          boxShadow: "0 6px 14px rgba(244,132,90,0.32)",
        }}
      >
        Read more
        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
      </Link>
    </section>
  );
}
