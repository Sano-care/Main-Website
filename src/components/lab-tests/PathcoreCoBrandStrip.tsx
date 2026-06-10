import Image from "next/image";

/**
 * T28 — Co-brand strip surfaced on the diagnostics surfaces.
 *
 * Two variants:
 *   "default"  — brand-blue headline + Pathcore logo. Used on
 *                /lab-tests, sits inside the hero between the intro
 *                paragraph and the search input. Mobile stacks logo
 *                above headline; desktop is a horizontal row with the
 *                logo to the right.
 *   "compact"  — single-line credit with a small logo. Used inside
 *                LabTestBasket (rail + drawer) where vertical space
 *                is tight.
 *
 * Founder-locked copy (2026-06-09): headline only, NO supporting line.
 * Specifically NO mention of NABL / ISO / accreditation (ASCI risk),
 * NO AIIMS / PGIMER training claim, NO "40+ years" claim — those are
 * deferred to a future PR pending Pathcore written sign-off.
 *
 * Visual: border-based card, no gradient, no shadow per "we are not a
 * fintech".
 *
 * Uses /pathcore/pathcore-logo.png (the standalone Pathcore mark).
 * Deliberately NOT using sanocare_pathcore_lockup.png — its Sanocare
 * wordmark is typeset in Poppins, which would compound brand drift
 * the founder flagged on the sign-in page.
 */
export function PathcoreCoBrandStrip({
  variant = "default",
}: {
  variant?: "default" | "compact";
}) {
  if (variant === "compact") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-text-secondary">
        <Image
          src="/pathcore/pathcore-logo.png"
          alt="Pathcore Diagnostics logo"
          width={80}
          height={24}
          className="h-4 w-auto shrink-0"
        />
        <span className="leading-tight">
          Diagnostics by{" "}
          <span className="font-semibold text-text-main">Pathcore</span>
        </span>
      </div>
    );
  }

  return (
    <div
      aria-label="Diagnostics partnership"
      className="bg-white border border-slate-200 rounded-2xl px-5 py-4 sm:px-6 sm:py-5 flex flex-col sm:flex-row items-center justify-center sm:justify-between gap-3 sm:gap-5"
    >
      {/* Headline — primary blue, font inherits Inter from body. */}
      <p className="text-sm sm:text-base font-semibold text-primary text-center sm:text-left order-2 sm:order-1">
        Diagnostics powered by Pathcore Diagnostics
      </p>

      {/* Logo — height ~40-44px. Mobile stacks above the headline
          (order-1), desktop sits to the right (order-2). */}
      <Image
        src="/pathcore/pathcore-logo.png"
        alt="Pathcore Diagnostics logo"
        width={180}
        height={48}
        className="h-10 sm:h-11 w-auto shrink-0 order-1 sm:order-2"
        priority
      />
    </div>
  );
}
