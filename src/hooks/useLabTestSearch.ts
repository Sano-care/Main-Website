"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LabTest } from "@/types/lab-test";

/**
 * useLabTestSearch — lazy-loads the lab-tests.json catalog (≈900 KB) the first
 * time the user interacts, then runs a fast weighted in-memory search.
 *
 * Match weights:
 *   - exact code match              : 100
 *   - code starts-with              : 50
 *   - name starts-with (word)       : 30
 *   - name contains (substring)     : 10
 *   - utility contains              :  3
 *
 * Returns top N (default 8) for the search dropdown.
 */
export function useLabTestSearch(query: string, limit = 8) {
  const [catalog, setCatalog] = useState<LabTest[] | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const requestedRef = useRef(false);

  // Lazy-load on first non-empty query
  useEffect(() => {
    if (!query.trim()) return;
    if (catalog || requestedRef.current) return;
    requestedRef.current = true;
    fetch("/lab-tests.json")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load lab catalog");
        return r.json();
      })
      .then((data: LabTest[]) => setCatalog(data))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to load lab catalog";
        setLoadingError(msg);
        requestedRef.current = false;
      });
  }, [query, catalog]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !catalog) return [];

    const scored: { test: LabTest; score: number }[] = [];
    for (const t of catalog) {
      const code = t.code.toLowerCase();
      const name = t.name.toLowerCase();
      const utility = t.utility.toLowerCase();

      let score = 0;

      if (code === q) score += 100;
      else if (code.startsWith(q)) score += 50;

      // word-level startsWith for the name
      const words = name.split(/\s+/);
      for (const w of words) {
        if (w.startsWith(q)) {
          score += 30;
          break;
        }
      }

      if (name.includes(q)) score += 10;
      if (utility.includes(q)) score += 3;

      if (score > 0) scored.push({ test: t, score });
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Tie-break: lower price first (most-searched cheap tests on top)
      return a.test.price - b.test.price;
    });

    return scored.slice(0, limit).map((s) => s.test);
  }, [query, catalog, limit]);

  return {
    results,
    isLoading: !!query.trim() && !catalog && !loadingError,
    error: loadingError,
    catalogSize: catalog?.length ?? 0,
  };
}
