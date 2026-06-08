"use client";

// T85 PR4b — pricing breakdown card.
//   Subtotal: ₹{sum of priceInr × qty}
//   Collection fee: ₹200
//   Coupon discount: −₹{discountInr}  (only if applied)
//   Grand Total: bold, larger type
//
// Grand total = max(0, ceil(subtotal − discount + 200)). The Math.ceil
// matches the create-order route's server-side computation so client
// display + server billed amount agree.

import { LAB_COLLECTION_FEE_INR } from "@/lib/services/labCatalog";
import type { AppliedLabCoupon } from "./types";

interface SubtotalBlockProps {
  subtotalInr: number;
  applied: AppliedLabCoupon | null;
}

export function SubtotalBlock({ subtotalInr, applied }: SubtotalBlockProps) {
  const discountInr = applied?.discountInr ?? 0;
  const grandTotalInr = Math.max(
    0,
    Math.ceil(subtotalInr - discountInr + LAB_COLLECTION_FEE_INR),
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
      <Row
        label="Subtotal"
        value={`₹${subtotalInr.toLocaleString("en-IN")}`}
      />
      <Row
        label="Collection fee"
        value={`₹${LAB_COLLECTION_FEE_INR.toLocaleString("en-IN")}`}
      />
      {applied && (
        <Row
          label={`Coupon (${applied.code})`}
          value={`−₹${discountInr.toLocaleString("en-IN")}`}
          tone="discount"
        />
      )}
      <div className="border-t border-slate-100 pt-2.5 flex items-baseline justify-between gap-3">
        <span className="text-sm font-bold text-text-main">Grand Total</span>
        <span className="text-lg font-bold text-text-main">
          ₹{grandTotalInr.toLocaleString("en-IN")}
        </span>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "discount";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[13px] text-text-secondary">{label}</span>
      <span
        className={`text-[13px] tabular-nums ${
          tone === "discount" ? "text-emerald-700 font-semibold" : "text-text-main"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
