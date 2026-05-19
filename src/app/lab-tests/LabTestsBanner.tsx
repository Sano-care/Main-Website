"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Info, X } from "lucide-react";

/**
 * Renders a one-time explanation banner when the patient lands on /lab-tests
 * from the homepage booking form (?from=hero). Lab tests are a different
 * flow from the rest of the SKUs — priced per-test, paid after the report
 * is delivered — and the redirect from Hero can be surprising without context.
 *
 * Dismissable via the close button or auto-hides after 12 seconds.
 */
export function LabTestsBanner() {
  const searchParams = useSearchParams();
  const fromHero = searchParams.get("from") === "hero";
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!fromHero) return;
    const timer = setTimeout(() => setDismissed(true), 12_000);
    return () => clearTimeout(timer);
  }, [fromHero]);

  if (!fromHero || dismissed) return null;

  return (
    <div
      role="status"
      className="mx-auto mt-6 max-w-4xl rounded-2xl border border-primary-100 bg-primary-50 px-5 py-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="flex-1 text-sm leading-relaxed text-text-main">
          <span className="font-semibold">Lab tests work differently.</span>{" "}
          They&apos;re priced per-test. Add the tests you need to your basket
          below, then schedule a free home collection. You only pay after the
          report is delivered.
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="rounded-md p-1 text-text-secondary transition-colors hover:bg-white/60 hover:text-text-main"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
