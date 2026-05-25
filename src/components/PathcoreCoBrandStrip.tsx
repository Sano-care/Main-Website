import Image from "next/image";

/**
 * Co-brand strip surfaced on the diagnostics surfaces — the /lab-tests
 * landing, the lab-test basket. Names Pathcore Diagnostics as the
 * laboratory processing Sanocare's lab tests.
 *
 * Two visual variants:
 *   "default"  — full strip with logo + headline + supporting line.
 *                Used on /lab-tests (above the hero) and any other
 *                top-of-page surface that has room for full copy.
 *   "compact"  — single-line credit with a small logo. Used inside the
 *                LabTestBasket (rail + drawer) where vertical space is
 *                tighter.
 *
 * Strictly NO accreditation claim ("NABL", "ISO", certificate numbers)
 * appears here, by founder direction — Pathcore's public site
 * publishes no accreditation, and an unverified claim is an ASCI
 * false-advertising risk. The copy below is a credentials line, not an
 * accreditation line.
 *
 * Copy is the founder-drafted version pending Pathcore sign-off; tweak
 * here when the final wording lands.
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
          src="/partners/pathcore_logo.png"
          alt="Pathcore Diagnostics"
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
    <section
      aria-label="Diagnostics partnership"
      className="bg-white border-y border-slate-200"
    >
      <div className="mx-auto max-w-6xl px-6 lg:px-8 py-5 flex items-center gap-5 sm:gap-6 flex-wrap">
        <Image
          src="/partners/pathcore_logo.png"
          alt="Pathcore Diagnostics"
          width={160}
          height={52}
          className="h-10 sm:h-12 w-auto shrink-0"
          priority
        />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm sm:text-base text-text-main">
            Diagnostics powered by Pathcore Diagnostics
          </div>
          <p className="text-xs sm:text-sm text-text-secondary mt-1 leading-relaxed max-w-3xl">
            Your lab tests are processed by Pathcore Diagnostics — a Delhi
            pathology lab led by senior pathologists with AIIMS / PGIMER
            training and 40+ years of collective diagnostic experience.
          </p>
        </div>
      </div>
    </section>
  );
}
