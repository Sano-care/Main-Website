"use client";

// T85 PR4b — Common Tests grid. 12 cards in a 3×4 layout (responsive:
// 2 cols on narrow phones, 3 on mid, 4 on tablet+).
//
// Position 1+2: Sanocare-branded packages with "Popular" badge.
// Positions 3-12: individual tests.
//
// Tapping a card adds the item to the basket with qty 1. If the item
// is already in the basket, the card switches to an "Added ✓" pill
// state (and tap becomes a remove). For packages the qty cap is 1 so
// the add↔remove toggle is the entire interaction.

import { Plus, Check, Star } from "lucide-react";
import { LAB_COMMON_TESTS, type LabCatalogItem } from "@/lib/services/labCatalog";
import type { BasketLine } from "./types";

interface CommonTestsGridProps {
  basket: ReadonlyArray<BasketLine>;
  onAdd: (item: LabCatalogItem) => void;
  onRemove: (id: string) => void;
}

export function CommonTestsGrid({ basket, onAdd, onRemove }: CommonTestsGridProps) {
  const inBasket = new Set(basket.map((b) => b.id));

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {LAB_COMMON_TESTS.map((item) => {
        const added = inBasket.has(item.id);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => (added ? onRemove(item.id) : onAdd(item))}
            aria-pressed={added}
            className={`relative text-left rounded-xl border bg-white p-3 transition-colors ${
              added
                ? "border-primary bg-primary/5"
                : "border-slate-200 hover:border-slate-300"
            }`}
          >
            {item.kind === "package" && item.popular && (
              <span className="absolute -top-2 -right-2 inline-flex items-center gap-1 rounded-full bg-[color:var(--color-accent-coral)] px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-white shadow-sm">
                <Star className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
                Popular
              </span>
            )}
            <div className="text-[13px] font-semibold text-text-main leading-tight line-clamp-2 min-h-[2.6em]">
              {item.name}
            </div>
            {item.kind === "package" && (
              <div className="mt-1 text-[10.5px] text-text-secondary">
                {item.subline}
              </div>
            )}
            <div className="mt-2 flex items-center justify-between gap-1.5">
              <div className="flex items-baseline gap-1.5 flex-1 min-w-0">
                <span className="text-[11px] text-slate-400 line-through">
                  ₹{item.mrp.toLocaleString("en-IN")}
                </span>
                <span className="text-[13px] font-bold text-text-main">
                  ₹{item.price.toLocaleString("en-IN")}
                </span>
              </div>
              <span
                className={`inline-flex items-center justify-center w-7 h-7 rounded-full shrink-0 transition-colors ${
                  added
                    ? "bg-primary text-white"
                    : "bg-slate-100 text-text-main hover:bg-slate-200"
                }`}
              >
                {added ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
