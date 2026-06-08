"use client";

// T85 PR4b — sticky top search bar for LabBasketWindow.
//
// Debounces the typed query (200ms), hits /api/lab/search, and shows
// up to 12 results in a dropdown. Tap a result → caller's onPick adds
// it to the basket with qty 1.
//
// Patient-facing — never gates on auth. The route does the same.

import { useEffect, useRef, useState } from "react";
import { Search, Loader2, X } from "lucide-react";

interface SearchResult {
  code: string;
  name: string;
  priceInr: number;
  sample?: string;
  tat?: string;
  category?: string;
}

interface SearchBarProps {
  onPick: (result: SearchResult) => void;
}

const DEBOUNCE_MS = 200;

export function SearchBar({ onPick }: SearchBarProps) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/lab/search?q=${encodeURIComponent(q.trim())}&limit=12`,
          { signal: ctl.signal },
        );
        if (!res.ok) {
          setResults([]);
          return;
        }
        const json = (await res.json()) as { results?: SearchResult[] };
        setResults(json.results ?? []);
        setOpen(true);
      } catch (err) {
        // Aborted requests come through as AbortError — ignore.
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          console.error("[SearchBar] search failed", err);
        }
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q]);

  function handlePick(r: SearchResult) {
    onPick(r);
    // Clear for the next search but keep the dropdown closed.
    setQ("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div className="relative">
      <div className="flex items-center rounded-xl border border-slate-200 bg-white focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 transition-all">
        <span className="pl-3 text-slate-400">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
        </span>
        <input
          type="search"
          inputMode="search"
          placeholder="Search 1,892 tests"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="flex-1 bg-transparent px-3 py-3 text-sm outline-none placeholder:text-slate-400"
        />
        {q.length > 0 && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Clear search"
            className="pr-3 text-slate-400 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-10 mt-2 w-full rounded-xl border border-slate-200 bg-white shadow-lg max-h-72 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.code}
              type="button"
              onClick={() => handlePick(r)}
              className="w-full text-left px-3 py-2.5 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-b-0"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-text-main truncate">
                    {r.name}
                  </div>
                  <div className="text-[11px] text-text-secondary mt-0.5">
                    {r.code}
                    {r.tat && <span> · {r.tat}</span>}
                  </div>
                </div>
                <div className="text-[13px] font-semibold text-text-main shrink-0">
                  ₹{r.priceInr.toLocaleString("en-IN")}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export type { SearchResult };
