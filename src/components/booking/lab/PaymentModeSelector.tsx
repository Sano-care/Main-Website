"use client";

// T85 PR4b v2 — payment mode selector for LabBasketWindow.
//
// Two radio options stacked vertically:
//   A. "Pay ₹{grand_total} now, no doorstep payment"     ← default
//   B. "Pay ₹200 now, ₹{balance} at collection"
//
// Selection drives the sticky PayCTA's label + amount. When Mode B is
// chosen, a small note appears under the CTA via the parent's render
// ("Tests process after ₹{balance} is collected at the door via UPI").
//
// Coupons apply ONLY to Mode A (full prepaid). Mode B's ₹200 is a fixed
// collection fee — no coupon discount. The parent component is
// responsible for visually disabling/hiding the coupon section when
// Mode B is active (or for surfacing the rule to the user). PR4b ships
// with the simpler behavior: coupon stays applied to the basket total
// for the Mode A grand-total calculation; Mode B ignores it
// server-side, and the UI shows the right amounts regardless.

import { LAB_COLLECTION_FEE_INR } from "@/lib/services/labCatalog";

export type LabPaymentMode = "full" | "partial";

interface PaymentModeSelectorProps {
  value: LabPaymentMode;
  onChange: (next: LabPaymentMode) => void;
  /** Grand total for Mode A (full prepaid). Mode B amount is ₹200 fixed. */
  fullGrandTotalInr: number;
}

export function PaymentModeSelector({
  value,
  onChange,
  fullGrandTotalInr,
}: PaymentModeSelectorProps) {
  const balanceInr = Math.max(0, fullGrandTotalInr - LAB_COLLECTION_FEE_INR);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-2.5">
        Payment
      </h3>
      <div className="space-y-2">
        <PaymentOption
          isSelected={value === "full"}
          onSelect={() => onChange("full")}
          title={`Pay ₹${fullGrandTotalInr.toLocaleString("en-IN")} now`}
          subtitle="No doorstep payment"
        />
        <PaymentOption
          isSelected={value === "partial"}
          onSelect={() => onChange("partial")}
          title={`Pay ₹${LAB_COLLECTION_FEE_INR} now`}
          subtitle={`₹${balanceInr.toLocaleString("en-IN")} at collection`}
        />
      </div>
    </div>
  );
}

function PaymentOption({
  isSelected,
  onSelect,
  title,
  subtitle,
}: {
  isSelected: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={`w-full flex items-start gap-3 rounded-xl p-3 transition-colors text-left ${
        isSelected
          ? "bg-primary/5 ring-2 ring-primary"
          : "bg-slate-50 hover:bg-slate-100"
      }`}
    >
      {/* Radio dot */}
      <span
        className={`shrink-0 mt-0.5 w-4 h-4 rounded-full border-2 ${
          isSelected
            ? "border-primary bg-primary"
            : "border-slate-300 bg-white"
        } flex items-center justify-center`}
        aria-hidden="true"
      >
        {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
      </span>
      <div className="flex-1">
        <div className="text-[13.5px] font-semibold text-text-main">
          {title}
        </div>
        <div className="text-[12px] text-text-secondary mt-0.5">
          {subtitle}
        </div>
      </div>
    </button>
  );
}
