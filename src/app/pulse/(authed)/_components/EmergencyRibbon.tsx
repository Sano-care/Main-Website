"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Phone } from "lucide-react";

import { incrementSessionCount } from "../_lib/sessionCount";

/**
 * T90 Pulse v1 Phase 1 — Emergency ribbon (Surface 6 sub-element of
 * the home zone stack, sits between top app bar and greeting).
 *
 * Always-visible, no dismissal in Phase 1. Two stacked elements:
 *
 *   1. Coral-tint ribbon (full row tappable) — opens tel:112
 *      Background:  #F4845A at 12% opacity over white
 *      Border:      1px #F4845A at 30%
 *      Phone icon:  16px, #C44A1B (darker coral, 4.5:1 contrast)
 *      Text:        Inter Medium 14px, #7A2E0C
 *      Right caret: 16px chevron #7A2E0C
 *      Tap:         <a href="tel:112">
 *      aria-label:  "In a medical or other emergency, tap to call
 *                    112, India's emergency number"
 *
 *   2. Disclaimer (sessions 1-3 only)
 *      Inter Regular 11px, #6B7280 (gray), centred
 *      Copy: "Sanocare provides planned care, not emergency services."
 *
 * Session-count integration: this component owns both the increment
 * (one-shot per mount, debounced inside sessionCount.ts) and the
 * read. Combined to avoid a race between two siblings' useEffects.
 * The home page just mounts <EmergencyRibbon /> — no separate
 * tracker component needed.
 *
 * Hydration-safe pattern: `count` starts as null, set on mount via
 * useEffect. The disclaimer renders only when count !== null AND
 * count <= 3, so SSR + first-paint show the ribbon WITHOUT the
 * disclaimer (no flicker on hydration). Disclaimer fades in 1 frame
 * after mount; this matches the founder's "Should NOT show on first
 * session ever" constraint loosely — first-render shows ribbon-only,
 * disclaimer follows from useEffect when count is determined.
 */

export default function EmergencyRibbon() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    // Bump + read in one go. Debounced inside sessionCount.ts so a
    // quick back-forward re-mount within 60s of the last bump leaves
    // the count unchanged.
    setCount(incrementSessionCount());
  }, []);

  const showDisclaimer = count !== null && count <= 3;

  return (
    <div className="w-full">
      <a
        href="tel:112"
        aria-label="In a medical or other emergency, tap to call 112, India's emergency number"
        className="flex w-full items-center justify-between gap-3 border px-3 py-2.5 transition-colors"
        style={{
          // Inline hex/alpha to avoid Tailwind 4 token resolution
          // ambiguity for the very specific 12% / 30% opacity values
          // the brief calls out. backgroundColor uses the rgba form
          // for "coral at 12% over white" semantics.
          backgroundColor: "rgba(244, 132, 90, 0.12)",
          borderColor: "rgba(244, 132, 90, 0.30)",
          color: "#7A2E0C",
        }}
      >
        <span className="flex items-center gap-2">
          <Phone
            className="h-4 w-4 shrink-0"
            style={{ color: "#C44A1B" }}
            aria-hidden="true"
          />
          <span className="text-sm font-medium">
            In an emergency, call 112
          </span>
        </span>
        <ChevronRight
          className="h-4 w-4 shrink-0"
          style={{ color: "#7A2E0C" }}
          aria-hidden="true"
        />
      </a>

      {showDisclaimer ? (
        <p className="px-3 py-1.5 text-center text-[11px] text-gray-500">
          Sanocare provides planned care, not emergency services.
        </p>
      ) : null}
    </div>
  );
}
