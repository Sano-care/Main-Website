import Image from "next/image";
import { ChevronDown } from "lucide-react";

/**
 * T28 — "About Pathcore Diagnostics" expandable section.
 *
 * Bottom of /lab-tests, below all lab listings + CTAs, above the
 * footer. Collapsed by default; user clicks the header to expand.
 *
 * Implemented via native <details>/<summary> for server-renderability
 * + zero client JS — the chevron rotation is driven by Tailwind's
 * group-open / open: utilities reading the disclosure's open state
 * directly off the DOM. The default browser disclosure triangle is
 * hidden so we render our own chevron.
 *
 * Copy is founder-locked (2026-06-09). Three paragraphs verbatim, NO
 * additions: trust statement, how-it-works, data-residency. The
 * "How it works:" prefix is a bold lead-in inline with the sentence,
 * not a new section heading — keeps the three paragraphs visually
 * equivalent.
 *
 * Hard constraints (carry from the strip's spec):
 *   - NO accreditation claim (NABL / ISO / accredited)
 *   - NO AIIMS / PGIMER claim
 *   - NO "40+ years" claim
 * All deferred to a future PR pending Pathcore written sign-off.
 */
export function PathcoreAboutSection() {
  return (
    <section
      aria-label="About Pathcore Diagnostics"
      className="mx-auto max-w-4xl px-6 lg:px-8 py-10"
    >
      <details className="group bg-white border border-slate-200 rounded-2xl open:shadow-sm">
        {/* `summary` is the always-visible header. The marker-hidden
            utility kills the default browser triangle so we control
            the chevron ourselves. */}
        <summary className="flex items-center gap-3 px-5 py-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-slate-50 rounded-2xl group-open:rounded-b-none transition-colors">
          <Image
            src="/pathcore/pathcore-logo.png"
            alt=""
            width={120}
            height={32}
            className="h-7 w-auto shrink-0"
            aria-hidden="true"
          />
          <span className="flex-1 text-sm sm:text-base font-semibold text-text-main">
            About Pathcore Diagnostics
          </span>
          <ChevronDown
            className="h-5 w-5 shrink-0 text-text-secondary transition-transform group-open:rotate-180 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </summary>

        {/* Body — only renders visually when <details open>. Copy
            below is founder-locked and verbatim. */}
        <div className="px-5 pb-5 pt-1 text-sm sm:text-[15px] leading-relaxed text-text-secondary space-y-4 border-t border-slate-100">
          <p>
            Your lab tests are processed by Pathcore Diagnostics, our trusted
            Delhi pathology partner. We chose Pathcore because their team
            prioritizes accurate, timely diagnostics — the partner we want
            behind every Sanocare report.
          </p>
          <p>
            <strong className="font-semibold text-text-main">
              How it works:
            </strong>{" "}
            Sanocare collects your sample at your home. Pathcore processes the
            sample at their Delhi pathology lab. Your reports come back to you
            on WhatsApp and your Sanocare Pulse account, secured by a
            magic-link unlock.
          </p>
          <p>
            Your data stays in India and is shared with Pathcore only for the
            specific test you booked.
          </p>
        </div>
      </details>
    </section>
  );
}
