"use client";

// T85 PR4b — basket line items + per-line stepper + remove.
//
// Only renders when at least one item is in the basket (caller
// short-circuits). Section header includes a "Clear all" link.
//
// Stepper rules:
//   - Packages (isPackage=true): qty fixed at 1 — show count but
//     disable +/-. Patient removes via trash icon.
//   - Individual tests: standard +/- stepper, min 1.
//
// Strikethrough MRP visible per line per founder Q4=a.

import { Minus, Plus, Trash2 } from "lucide-react";
import type { BasketLine } from "./types";

interface BasketSectionProps {
  basket: ReadonlyArray<BasketLine>;
  onIncrement: (id: string) => void;
  onDecrement: (id: string) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
}

export function BasketSection({
  basket,
  onIncrement,
  onDecrement,
  onRemove,
  onClearAll,
}: BasketSectionProps) {
  if (basket.length === 0) return null;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-main">
          Your Basket ({basket.length} {basket.length === 1 ? "item" : "items"})
        </h3>
        <button
          type="button"
          onClick={onClearAll}
          className="text-[12px] font-semibold text-primary hover:underline"
        >
          Clear all
        </button>
      </div>
      <ul className="divide-y divide-slate-100">
        {basket.map((line) => (
          <li key={line.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-text-main">
                  {line.name}
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-[11px] text-slate-400 line-through">
                    ₹{line.mrpInr.toLocaleString("en-IN")}
                  </span>
                  <span className="text-[13px] font-bold text-text-main">
                    ₹{line.priceInr.toLocaleString("en-IN")}
                  </span>
                </div>
              </div>

              {/* Stepper + trash */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => onDecrement(line.id)}
                  disabled={line.isPackage || line.qty <= 1}
                  aria-label="Decrease quantity"
                  className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 text-text-main hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-[1.5ch] text-center text-[13px] font-semibold tabular-nums">
                  {line.qty}
                </span>
                <button
                  type="button"
                  onClick={() => onIncrement(line.id)}
                  disabled={line.isPackage}
                  aria-label="Increase quantity"
                  className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 text-text-main hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(line.id)}
                  aria-label="Remove from basket"
                  className="ml-1 inline-flex items-center justify-center w-7 h-7 rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-700 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
