"use client";

// T85 PR4b — coupon section. Manual entry (top) + 3 suggested coupon
// tiles (below) per founder direction. The 3 tiles surface ALL active
// coupons (capped at 3, newest first) regardless of basket subtotal —
// per founder UAT preview-42 reversal of Q2 (2026-06-08 v3):
//   - Applicable tiles render with full opacity. Best applied to
//     current basket gets a coral border.
//   - Inapplicable tiles (basket < `min_basket_inr`) render greyed out
//     with a "Spend ₹{remaining_inr} more to unlock" subline. This is
//     the Zepto/Blinkit AOV-upsell pattern — never hide an existing
//     offer, surface the gap to the next threshold instead.
//
// `max_uses` exhaustion is still a hard hide — an exhausted coupon
// literally cannot be applied even if the basket grows. Only the
// min-basket threshold drives the greyed-state.
//
// Apply tap → /api/lab/validate-coupon → on success, the section
// collapses to an "Applied ✓" pill with a Remove link.

import { useEffect, useState } from "react";
import { Tag, Loader2, Check } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import type { AppliedLabCoupon } from "./types";

interface SuggestedCoupon {
  code: string;
  description: string | null;
  minBasketInr: number;
  // Pre-computed potential discount for the current subtotal, used
  // for the "best" highlighting among applicable tiles.
  potentialDiscountInr: number;
  // T85 PR4b v3 — basket < min_basket_inr triggers the greyed state
  // with the unlock-threshold subline. Computed at fetch time so the
  // render path stays simple.
  isApplicable: boolean;
  unlockDiffInr: number;
}

interface CouponSectionProps {
  subtotalInr: number;
  applied: AppliedLabCoupon | null;
  onApply: (coupon: AppliedLabCoupon) => void;
  onRemove: () => void;
}

export function CouponSection({
  subtotalInr,
  applied,
  onApply,
  onRemove,
}: CouponSectionProps) {
  const [suggested, setSuggested] = useState<SuggestedCoupon[]>([]);
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // code being applied
  const [error, setError] = useState<string | null>(null);

  // Fetch suggested coupons whenever subtotal crosses a threshold.
  // We use a public Supabase anon-key path here — `lab_coupons` is
  // intentionally readable (founder marks `is_active=true` to surface,
  // false to hide). No PII. If anon key is missing the list is empty
  // and patients still have manual entry.
  useEffect(() => {
    if (subtotalInr <= 0) {
      setSuggested([]);
      return;
    }
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      setSuggested([]);
      return;
    }
    const supabase = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
    });

    let cancelled = false;
    (async () => {
      const nowIso = new Date().toISOString();
      const { data } = await supabase
        .from("lab_coupons")
        .select(
          "code, description, discount_type, discount_value, min_basket_inr, max_discount_inr, max_uses, used_count, valid_from, valid_to",
        )
        .eq("is_active", true)
        .or(`valid_from.is.null,valid_from.lte.${nowIso}`)
        .or(`valid_to.is.null,valid_to.gte.${nowIso}`)
        .order("created_at", { ascending: false })
        .limit(10);

      if (cancelled) return;
      // T85 PR4b v3 — drop only max_uses-exhausted coupons; keep
      // min_basket-inapplicable ones so they render greyed-out with
      // the "Spend ₹X more to unlock" subline (AOV upsell pattern).
      const usable = (data ?? [])
        .filter((c) => {
          if (c.max_uses != null && c.used_count >= c.max_uses) return false;
          return true;
        })
        .map((c) => {
          const minBasket = (c.min_basket_inr as number) ?? 0;
          const isApplicable = subtotalInr >= minBasket;
          // Compute potential discount AGAINST THE CURRENT SUBTOTAL
          // even for inapplicable coupons — gives a stable basis for
          // the "best" highlight ordering once the patient unlocks.
          // (Discount is capped at subtotal anyway; for inapplicable
          // tiles the value is informational only — Apply is disabled.)
          let discount = 0;
          if (c.discount_type === "percent") {
            discount = Math.floor(
              (subtotalInr * Number(c.discount_value)) / 100,
            );
          } else {
            discount = Number(c.discount_value);
          }
          if (c.max_discount_inr != null) {
            discount = Math.min(discount, c.max_discount_inr);
          }
          return {
            code: c.code as string,
            description: (c.description as string | null) ?? null,
            minBasketInr: minBasket,
            potentialDiscountInr: Math.max(0, Math.min(discount, subtotalInr)),
            isApplicable,
            unlockDiffInr: isApplicable ? 0 : Math.max(0, minBasket - subtotalInr),
          };
        })
        .slice(0, 3);
      setSuggested(usable);
    })();
    return () => {
      cancelled = true;
    };
  }, [subtotalInr]);

  async function tryApply(code: string) {
    setError(null);
    setBusy(code);
    try {
      const res = await fetch("/api/lab/validate-coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, subtotalInr }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        code?: string;
        discountPercent?: number;
        discountInr?: number;
        description?: string | null;
        error?: string;
      };
      if (!json.ok) {
        setError(json.error || "Coupon couldn't be applied.");
        return;
      }
      onApply({
        code: json.code as string,
        discountInr: json.discountInr ?? 0,
        discountPercent: json.discountPercent ?? 0,
        description: json.description ?? null,
      });
      setManualCode("");
    } finally {
      setBusy(null);
    }
  }

  // Highlight the highest-discount APPLICABLE tile. Inapplicable
  // tiles don't compete for the "best" coral border — they're
  // greyed out anyway, so giving them a highlight would conflict
  // with the muted-state styling.
  const bestCode = suggested.reduce<string | null>((acc, c) => {
    if (!c.isApplicable) return acc;
    if (acc === null) return c.code;
    const prev = suggested.find((s) => s.code === acc);
    return prev && c.potentialDiscountInr > prev.potentialDiscountInr
      ? c.code
      : acc;
  }, null);

  if (applied) {
    return (
      <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-600 text-white shrink-0">
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-emerald-900">
              Applied {applied.code}
            </div>
            <div className="text-[11px] text-emerald-800 truncate">
              −₹{applied.discountInr.toLocaleString("en-IN")}
              {applied.description ? ` · ${applied.description}` : ""}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-[12px] font-semibold text-emerald-900 hover:underline shrink-0"
        >
          Remove
        </button>
      </div>
    );
  }

  // T85 PR4b v2 — UI reorder. Manual entry input + Apply button live
  // at the top (always visible); suggested tiles act as quick-tap
  // fills below. Tapping a suggested tile copies its code into the
  // manual input + applies in one step. Inapplicable-hidden rule +
  // dynamic-add-on-threshold-cross logic unchanged.
  function quickFill(code: string) {
    setManualCode(code);
    void tryApply(code);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Tag className="h-4 w-4 text-[color:var(--color-accent-coral-dark)]" />
        <h3 className="text-sm font-bold text-text-main">Apply Coupon</h3>
      </div>

      {/* Manual entry — always visible at the top */}
      <div className="flex items-stretch gap-2">
        <input
          type="text"
          placeholder="Enter coupon code"
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value.toUpperCase())}
          className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm uppercase tracking-wider outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
        />
        <button
          type="button"
          disabled={!manualCode.trim() || busy !== null}
          onClick={() => tryApply(manualCode.trim())}
          className="inline-flex items-center justify-center rounded-xl bg-[color:var(--color-accent-coral)] hover:bg-[color:var(--color-accent-coral-dark)] text-white text-sm font-semibold px-4 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply"}
        </button>
      </div>

      {error && (
        <p className="text-[11.5px] text-rose-700" role="alert">
          {error}
        </p>
      )}

      {/* Suggested coupons — all 3 always rendered. Applicable tiles
          are full-opacity with active Apply button; inapplicable tiles
          render greyed-out with a "Spend ₹X more to unlock" subline
          (AOV upsell pattern). */}
      {suggested.length > 0 && (
        <div className="space-y-2 pt-1">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
            Suggested
          </h4>
          <ul className="space-y-2">
            {suggested.map((c) => {
              const isBest = c.code === bestCode;
              const isApplicable = c.isApplicable;
              return (
                <li
                  key={c.code}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition-opacity ${
                    isApplicable
                      ? isBest
                        ? "border-[color:var(--color-accent-coral)] bg-white"
                        : "border-slate-200 bg-white"
                      : "border-slate-200 bg-slate-100 opacity-60"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-text-main">
                      {c.code}
                    </div>
                    {c.description && (
                      <div className="text-[11px] text-text-secondary truncate">
                        {c.description}
                      </div>
                    )}
                    {!isApplicable && (
                      <div className="text-[11px] text-text-secondary mt-0.5">
                        Spend ₹{c.unlockDiffInr.toLocaleString("en-IN")} more
                        to unlock
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => quickFill(c.code)}
                    disabled={!isApplicable || busy === c.code}
                    className="inline-flex items-center justify-center rounded-lg bg-[color:var(--color-accent-coral)] hover:bg-[color:var(--color-accent-coral-dark)] text-white text-[12px] font-semibold px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[color:var(--color-accent-coral)]"
                  >
                    {busy === c.code ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      "Apply"
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
