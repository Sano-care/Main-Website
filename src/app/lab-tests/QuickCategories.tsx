"use client";

import { Beaker } from "lucide-react";

const CATEGORIES = [
  { label: "CBC", hint: "Complete Blood Count" },
  { label: "Thyroid", hint: "T3, T4, TSH, FT4" },
  { label: "Vitamin D", hint: "25-OH, 1,25-OH" },
  { label: "Diabetes", hint: "HbA1c, Glucose" },
  { label: "Lipid Profile", hint: "Cholesterol, HDL, LDL" },
  { label: "Liver Function", hint: "SGOT, SGPT, ALP" },
  { label: "Kidney", hint: "Creatinine, Urea" },
  { label: "Vitamin B12", hint: "Cobalamin" },
] as const;

export function QuickCategories() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {CATEGORIES.map((c) => (
        <button
          key={c.label}
          className="text-left bg-white border border-slate-200 hover:border-primary hover:shadow-md rounded-xl p-4 transition-all group"
          onClick={() => {
            const el = document.querySelector<HTMLInputElement>(
              'input[aria-label="Search lab tests"]',
            );
            if (el) {
              el.value = c.label;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.focus();
              el.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <Beaker className="w-4 h-4 text-primary" />
            <span className="font-semibold text-text-main">{c.label}</span>
          </div>
          <div className="text-xs text-text-secondary">{c.hint}</div>
        </button>
      ))}
    </div>
  );
}
