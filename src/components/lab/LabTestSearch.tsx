"use client";

import { useState, useRef, useEffect } from "react";
import { Search, X, Loader2, FlaskConical, Clock, Droplet } from "lucide-react";
import { useLabTestSearch } from "@/hooks/useLabTestSearch";
import type { LabTest } from "@/types/lab-test";
import { useBookingStore } from "@/store/bookingStore";

interface LabTestSearchProps {
  /** Hero size: large prominent search box. Compact: smaller embed for sections. */
  variant?: "hero" | "compact";
  /** Optional placeholder override */
  placeholder?: string;
}

const CATEGORY_BADGE_STYLES: Record<LabTest["category"], string> = {
  Routine: "bg-primary-50 text-primary-dark",
  Specialty:
    "bg-[color:var(--color-accent-coral-50)] text-[color:var(--color-accent-coral-dark)]",
  Oncology: "bg-rose-50 text-rose-700",
  Genetics: "bg-indigo-50 text-indigo-700",
};

export function LabTestSearch({
  variant = "hero",
  placeholder,
}: LabTestSearchProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<LabTest | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { results, isLoading, error, catalogSize } = useLabTestSearch(query, 8);
  const { setDetails, openModal, addSelectedTest, selectedTests } =
    useBookingStore();

  // Close dropdown when clicking outside
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function handleBookTest(test: LabTest) {
    // CP7: just add to the basket. The patient adds more tests / applies coupons,
    // then the basket panel handles the "proceed to book" CTA which opens the
    // booking modal. We DO NOT open the modal here anymore.
    setDetails({ serviceCategory: "diagnostics" });
    addSelectedTest({
      code: test.code,
      name: test.name,
      price: test.price,
      sample: test.sample,
      tat: test.tat,
      category: test.category,
    });
    // Clear the selected test view so the search bar is ready for the next query.
    setSelected(null);
    setIsOpen(false);
  }

  const isInBasket = (code: string) =>
    selectedTests.some((t) => t.code === code);

  function handleClear() {
    setQuery("");
    setSelected(null);
    setIsOpen(false);
  }

  const isHero = variant === "hero";
  const inputClasses = isHero
    ? "h-14 lg:h-16 text-base lg:text-lg pl-14 pr-12 rounded-2xl"
    : "h-12 text-sm pl-11 pr-10 rounded-xl";

  return (
    <div className="w-full" ref={containerRef}>
      <div className="relative">
        <Search
          className={
            "absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary " +
            (isHero ? "w-5 h-5" : "w-4 h-4")
          }
        />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            setSelected(null);
          }}
          onFocus={() => query && setIsOpen(true)}
          placeholder={
            placeholder ??
            (isHero
              ? "Search 1,900+ lab tests — e.g. CBC, Vitamin D, Thyroid"
              : "Find a lab test")
          }
          className={
            inputClasses +
            " w-full bg-white border border-slate-200 text-text-main placeholder-text-secondary focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-shadow font-medium shadow-sm"
          }
          aria-label="Search lab tests"
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-text-secondary hover:text-text-main hover:bg-slate-100 transition-colors"
            aria-label="Clear search"
          >
            <X className={isHero ? "w-5 h-5" : "w-4 h-4"} />
          </button>
        )}

        {/* Dropdown */}
        {isOpen && query && (
          <div className="absolute left-0 right-0 top-full mt-2 z-50 bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden max-h-[420px] overflow-y-auto">
            {isLoading && (
              <div className="flex items-center gap-3 px-5 py-6 text-text-secondary text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading lab catalog…
              </div>
            )}
            {error && (
              <div className="px-5 py-6 text-rose-600 text-sm">
                Couldn&apos;t load the lab catalog. Please refresh the page or
                call us at +91-97119 77782.
              </div>
            )}
            {!isLoading && !error && results.length === 0 && (
              <div className="px-5 py-6 text-text-secondary text-sm">
                No tests match <strong>&ldquo;{query}&rdquo;</strong>. Try a
                different name or call us at{" "}
                <a
                  href="tel:+919711977782"
                  className="text-primary underline"
                >
                  +91-97119 77782
                </a>{" "}
                to ask about a specific test.
              </div>
            )}
            {!isLoading && !error && results.length > 0 && (
              <>
                <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 text-xs font-mono uppercase tracking-wider text-text-secondary flex items-center justify-between">
                  <span>
                    {results.length} match{results.length === 1 ? "" : "es"}
                  </span>
                  <span>From {catalogSize.toLocaleString("en-IN")} tests</span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {results.map((t) => (
                    <li key={t.code}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(t);
                          setIsOpen(false);
                        }}
                        className="w-full text-left px-5 py-3.5 hover:bg-primary-50 transition-colors flex items-start justify-between gap-4"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-text-main truncate">
                            {t.name}
                          </div>
                          <div className="mt-0.5 flex items-center gap-3 text-xs text-text-secondary">
                            <span className="font-mono">{t.code}</span>
                            <span
                              className={
                                "px-2 py-0.5 rounded-full font-medium " +
                                CATEGORY_BADGE_STYLES[t.category]
                              }
                            >
                              {t.category}
                            </span>
                            <span className="hidden sm:inline">
                              <Clock className="inline w-3 h-3 mr-1" />
                              {t.tat}
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-bold text-text-main text-lg leading-none">
                            ₹{t.price.toLocaleString("en-IN")}
                          </div>
                          <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary mt-1">
                            MRP
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      {/* Selected test detail card */}
      {selected && (
        <div className="mt-4 bg-white border border-primary-100 rounded-2xl p-5 lg:p-6 shadow-md">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={
                    "px-2 py-0.5 rounded-full text-xs font-medium " +
                    CATEGORY_BADGE_STYLES[selected.category]
                  }
                >
                  {selected.category}
                </span>
                <span className="font-mono text-xs text-text-secondary">
                  {selected.code}
                </span>
              </div>
              <h3 className="text-lg lg:text-xl font-bold text-text-main">
                {selected.name}
              </h3>
            </div>
            <div className="text-right shrink-0">
              <div className="text-2xl font-bold text-text-main leading-none">
                ₹{selected.price.toLocaleString("en-IN")}
              </div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary mt-1">
                MRP · Free home collection
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            <DetailField icon={Droplet} label="Sample" value={selected.sample} />
            <DetailField icon={Clock} label="TAT" value={selected.tat} />
            <DetailField icon={FlaskConical} label="Method" value={selected.method} />
          </div>

          {selected.instructions && (
            <div className="mb-3 text-sm text-text-main">
              <span className="font-semibold">Special instructions:</span>{" "}
              <span className="text-text-secondary">{selected.instructions}</span>
            </div>
          )}
          {selected.utility && (
            <div className="mb-5 text-sm text-text-secondary border-l-2 border-primary-100 pl-3 italic">
              {selected.utility}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => handleBookTest(selected)}
              disabled={isInBasket(selected.code)}
              className="inline-flex items-center gap-2 bg-[color:var(--color-accent-coral)] hover:bg-[color:var(--color-accent-coral-dark)] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-5 py-3 rounded-xl transition-colors shadow-md"
            >
              {isInBasket(selected.code) ? "Already in basket ✓" : "Add to basket →"}
            </button>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="inline-flex items-center gap-2 bg-white border border-slate-200 hover:border-primary text-text-main font-medium px-4 py-3 rounded-xl transition-colors"
            >
              Search another test
            </button>
            <a
              href="tel:+919711977782"
              className="inline-flex items-center gap-2 text-text-secondary hover:text-primary font-medium px-2 py-3 transition-colors"
            >
              Or call +91-97119 77782
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailField({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Droplet;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-slate-50 rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-text-secondary mb-1.5">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="text-sm text-text-main leading-snug">
        {value || "—"}
      </div>
    </div>
  );
}
