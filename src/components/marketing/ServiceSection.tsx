"use client";

// T85 — single props-driven service section. Renders one ServiceConfig
// in the exact pattern locked by mockup v4 (`Homepage_v2.1_Mockup.html`).
//
// Pattern, top-to-bottom:
//   1. Section tag eyebrow ("Service N of 4") — coral-dark, 11px uppercase
//   2. Head row: 56×56 blue-ghost icon + name H2 + price line
//   3. Description paragraph (40-60 words, grey-600)
//   4. "About {Name}" expandable — CLOSED by default
//        - Pricing
//        - Promise / waiting time
//        - What's included (bulleted)
//        - Best for
//   5. Green promise pill
//   6. Coral CTA — full-width, 52px tall, hrefs to /book?service={slug}
//   7. "Schedule for later" stub link (toast in PR2)
//
// Consistency rules enforced here so adding a 5th service is one
// ServiceConfig append, not a JSX edit:
//   - All four sections render with identical DOM shape — only catalog
//     data differs.
//   - Eyebrow is derived (${index + 1} of ${total}) — never hard-coded.
//   - Expandable state is local to each section (no shared accordion);
//     opening Service 2 doesn't close Service 1.
//   - prefers-reduced-motion ⇒ height transition is instant snap.
//
// Tailwind class set translates the mockup CSS verbatim:
//   .sec-tag      → text-[11px] tracking-[0.8px] uppercase font-bold text-[#E16A3D]
//   .sec-icon     → w-14 h-14 rounded-[16px] bg-primary/5 text-primary
//   .sec-meta h2  → text-2xl font-bold tracking-[-0.5px] leading-[1.15]
//   .sec-desc     → text-sm text-slate-600 leading-[1.6]
//   .promise-row  → inline-flex green-soft bg + green text, 9px radius
//   .cta-primary  → coral bg + shadow + tap-scale 0.985
//   .expand       → grey-50 bg + grey-150 border, 14px radius
//
// Coral hex `#E16A3D` for the eyebrow is the mockup's `--coral-dark`
// (different from the existing `tokens.ts coral.dark = #dc6a40`). PR2
// reconciles the palette; PR1 holds the mockup value inline to land the
// visual without forking tokens. Founder UAT will catch any drift.

import { useState } from "react";
import { ChevronRight, Clock, Check } from "lucide-react";
import Link from "next/link";
import type { ServiceConfig } from "@/lib/services/catalog";
import { getServiceIcon } from "./icons/ServiceIcons";

interface ServiceSectionProps {
  config: ServiceConfig;
  /** Zero-based index in the SERVICES array — drives the derived eyebrow. */
  index: number;
  /** Length of the SERVICES array — drives the derived eyebrow denominator. */
  total: number;
  /** Optional onScheduleClick — PR2 wires the toast. PR1 stubs to noop. */
  onScheduleClick?: () => void;
}

export function ServiceSection({
  config,
  index,
  total,
  onScheduleClick,
}: ServiceSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const Icon = getServiceIcon(config.iconKey);

  const handleSchedule = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onScheduleClick) {
      onScheduleClick();
    } else {
      // PR1 stub — PR2 replaces with a toast. Logging keeps the click
      // visible in DevTools during founder UAT so a missing handler is
      // obvious.
      console.log(`[t85] schedule-for-later clicked: ${config.slug}`);
    }
  };

  return (
    <section
      id={`service-${config.slug}`}
      className="bg-white px-[18px] pt-7 pb-[26px]"
      aria-labelledby={`service-${config.slug}-heading`}
    >
      {/* Eyebrow — Service N of total, coral-dark uppercase */}
      <p className="inline-block text-[11px] font-bold uppercase tracking-[0.8px] text-[#E16A3D] mb-3">
        Service {index + 1} of {total}
      </p>

      {/* Head — icon + name + price */}
      <div className="flex items-start gap-[14px] mb-[14px]">
        <div className="shrink-0 w-14 h-14 rounded-[16px] bg-primary/5 text-primary flex items-center justify-center">
          <Icon className="w-7 h-7 [stroke-width:1.8]" />
        </div>
        <div className="flex-1">
          <h2
            id={`service-${config.slug}-heading`}
            className="text-2xl font-bold tracking-[-0.5px] leading-[1.15] text-slate-900 mb-1.5"
          >
            {config.name}
          </h2>
          <p className="text-[13px] text-slate-600">
            <PriceLineText line={config.priceLine} />
          </p>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-slate-600 leading-[1.6] mb-[18px]">
        {config.description}
      </p>

      {/* Expandable "About {Name}" — CLOSED by default */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-controls={`expand-${config.slug}`}
        className="w-full bg-slate-50 border border-slate-200 rounded-[14px] px-4 py-3.5 cursor-pointer text-left"
      >
        <div className="flex items-center justify-between text-[13.5px] font-semibold text-slate-900">
          <span>About {config.name}</span>
          <span
            className="text-[22px] text-slate-400 font-light leading-none transition-transform motion-reduce:transition-none"
            aria-hidden="true"
          >
            {isExpanded ? "−" : "+"}
          </span>
        </div>
        <div
          id={`expand-${config.slug}`}
          className={`grid transition-all duration-200 ease-out motion-reduce:transition-none ${
            isExpanded
              ? "grid-rows-[1fr] opacity-100 mt-3"
              : "grid-rows-[0fr] opacity-0 mt-0"
          }`}
        >
          <div className="overflow-hidden">
            <div className="text-[13px] text-slate-700 leading-[1.6] space-y-3">
              <p>
                <strong className="font-semibold text-slate-900">
                  Pricing.
                </strong>{" "}
                {config.expandable.pricing}
              </p>
              <p>
                <strong className="font-semibold text-slate-900">
                  {/* "Arrival promise" / "No waiting time" — first sentence
                      of the promise text serves as the bold prefix; render
                      the whole sentence as one paragraph. The mockup
                      separates them but the brief copy already includes
                      the label inside the sentence ("Median time-to-medic
                      under 30 minutes…"). */}
                  Promise.
                </strong>{" "}
                {config.expandable.promise}
              </p>
              <div>
                <strong className="font-semibold text-slate-900">
                  What&apos;s included:
                </strong>
                <ul className="ml-5 mt-2 list-disc space-y-1">
                  {config.expandable.included.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <p>
                <strong className="font-semibold text-slate-900">
                  Best for:
                </strong>{" "}
                {config.expandable.bestFor}
              </p>
            </div>
          </div>
        </div>
      </button>

      {/* Green promise pill */}
      <div className="mt-[14px] mb-[18px]">
        <span className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold">
          <Check className="w-3.5 h-3.5 [stroke-width:2.5]" aria-hidden="true" />
          {config.promiseRow}
        </span>
      </div>

      {/* Primary CTA — coral, full-width, tap-scale */}
      <Link
        href={`/book?service=${config.slug}`}
        className="block w-full text-center bg-accent-coral text-white py-4 px-4 rounded-[14px] text-[15px] font-semibold tracking-[-0.1px] no-underline transition-transform duration-100 active:scale-[0.985] shadow-[0_8px_18px_rgba(244,132,90,0.36),0_2px_4px_rgba(244,132,90,0.20)]"
      >
        {config.ctaLabel}
      </Link>

      {/* Schedule-for-later soft escape */}
      <button
        type="button"
        onClick={handleSchedule}
        className="mt-[14px] mx-auto flex items-center gap-1.5 text-[13px] text-slate-600 font-medium hover:text-slate-900 transition-colors"
        aria-label={`Schedule ${config.name} for later`}
      >
        <Clock className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Schedule for later</span>
        <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </section>
  );
}

/**
 * Render a `PriceLine` as "From ₹N suffix" or as bare text. Encapsulated
 * here so the bold-amount markup stays in one place.
 */
function PriceLineText({ line }: { line: ServiceConfig["priceLine"] }) {
  if (line.kind === "from") {
    return (
      <>
        From <strong className="font-bold text-slate-900">₹{line.amount}</strong>{" "}
        {line.suffix}
      </>
    );
  }
  // The bare lab-tests row leads with a bold amount inline; split on the
  // first space-after-numeric to bold "₹200" without hard-coding it.
  // Match shape: "₹{amount} {rest}".
  const match = line.text.match(/^(₹[\d,]+)\s+(.+)$/);
  if (match) {
    return (
      <>
        <strong className="font-bold text-slate-900">{match[1]}</strong>{" "}
        {match[2]}
      </>
    );
  }
  return <>{line.text}</>;
}
