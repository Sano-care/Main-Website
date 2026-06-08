"use client";

// T85 PR4b — coupon section. 3 suggested coupon tiles + manual entry
// fallback (per founder Q3 = a). The 3 tiles surface the
// most-applicable active coupons given the current basket subtotal:
//   - Inapplicable coupons (basket < min) are HIDDEN (founder Q2 rule)
//   - Capped at 3 tiles, newest first if there are more
//   - Best/most-relevant tile gets a coral border (highest discount
//     applied to the current basket post-validation)
//
// Apply tap → /api/lab/validate-coupon → on success, the tile
// collapses to an "Applied ✓" pill with a Remove link.

import { useEffect, useState } from "react";
import { Tag, Loader2, Check, X } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import type { AppliedLabCoupon } from "./types";

interface SuggestedCoupon {
  code: string;
  description: string | null;
  minBasketInr: number;
  // Pre-computed potential discount for the current subtotal, used
  // for the "best" highlighting.
  potentialDiscountInr: number;
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
  const [showManual, setShowManual] = useState(false);
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
      const usable = (data ?? [])
        .filter((c) => {
          if (subtotalInr < (c.min_basket_inr ?? 0)) return false;
          if (c.max_uses != null && c.used_count >= c.max_uses) return false;
          return true;
        })
        .map((c) => {
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
            minBasketInr: (c.min_basket_inr as number) ?? 0,
            potentialDiscountInr: Math.max(0, Math.min(discount, subtotalInr)),
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
      setShowManual(false);
    } finally {
      setBusy(null);
    }
  }

  // Highlight the highest-discount tile.
  const bestCode = suggested.reduce<string | null>((acc, c) => {
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

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Tag className="h-4 w-4 text-[color:var(--color-accent-coral-dark)]" />
        <h3 className="text-sm font-bold text-text-main">Apply Coupon</h3>
      </div>

      {suggested.length > 0 && (
        <ul className="space-y-2">
          {suggested.map((c) => {
            const isBest = c.code === bestCode;
            return (
              <li
                key={c.code}
                className={`flex items-center justify-between gap-3 rounded-xl border bg-white px-3 py-2.5 ${
                  isBest
                    ? "border-[color:var(--color-accent-coral)]"
                    : "border-slate-200"
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
                </div>
                <button
                  type="button"
                  onClick={() => tryApply(c.code)}
                  disabled={busy === c.code}
                  className="inline-flex items-center justify-center rounded-lg bg-[color:var(--color-accent-coral)] hover:bg-[color:var(--color-accent-coral-dark)] text-white text-[12px] font-semibold px-3 py-1.5 disabled:opacity-60"
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
      )}

      {!showManual ? (
        <button
          type="button"
          onClick={() => setShowManual(true)}
          className="text-[12px] font-semibold text-primary hover:underline"
        >
          Have a code? Enter manually
        </button>
      ) : (
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
          <button
            type="button"
            onClick={() => {
              setShowManual(false);
              setManualCode("");
              setError(null);
            }}
            aria-label="Cancel manual entry"
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 px-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <p className="text-[11.5px] text-rose-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
