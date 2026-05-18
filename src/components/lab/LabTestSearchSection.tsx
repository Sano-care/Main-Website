"use client";

import Link from "next/link";
import { Beaker, ArrowRight } from "lucide-react";
import { LabTestSearch } from "@/components/lab/LabTestSearch";

/**
 * Homepage embed of the lab-test search. Lighter than the /lab-tests hero —
 * a single search row with a small lead-in headline. Placed between Hero and
 * StatsBar on `/` so it's the second thing visitors see.
 */
export function LabTestSearchSection() {
  return (
    <section className="relative py-12 lg:py-16 border-y border-slate-200 bg-gradient-to-b from-white to-primary-50/40">
      <div className="mx-auto max-w-4xl px-6 lg:px-8">
        <div className="flex items-center gap-2 mb-3">
          <Beaker className="w-4 h-4 text-[color:var(--color-accent-coral-dark)]" />
          <span className="font-mono text-[11px] tracking-widest uppercase text-[color:var(--color-accent-coral-dark)]">
            Lab tests at home — free collection
          </span>
        </div>
        <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-text-main mb-2">
          What test do you need? Find it in seconds.
        </h2>
        <p className="text-text-secondary mb-6 max-w-2xl">
          Search 1,900+ pathology and diagnostic tests. Free home collection
          across Kalkaji and Govindpuri Extension — you pay only for the test.
        </p>
        <LabTestSearch variant="hero" />
        <div className="mt-4 flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs text-text-secondary">
            Reports flow into your Sanocare record. NABL-partner labs.
          </p>
          <Link
            href="/lab-tests"
            className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-dark transition-colors"
          >
            See full catalog
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
