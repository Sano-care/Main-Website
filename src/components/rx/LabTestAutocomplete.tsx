"use client";

// Shared autocomplete for lab-test lookup against the Pathcore
// catalog (M027). Companion to DrugAutocomplete; same UX pattern:
//
//   - Doctor types test name OR Pathcore code (e.g. "BC0573")
//   - Component debounces (150 ms — slightly tighter than the
//     medicines field per the v3 brief) and queries
//     /api/doctor/lab-tests/search
//   - Top 12 matches render as a dropdown below the input.
//
// Dropdown item — two lines per result, per the brief §4 spec:
//
//   ┌────────────────────────────────────────────────────────────┐
//   │ Lipid Profile                          Routine · BC0123    │  ← line 1
//   │ Serum sample · TAT 1 day · ₹450                       [ + ]│  ← line 2
//   └────────────────────────────────────────────────────────────┘
//
// On pick:
//   - sets the row's `test_name` to the catalog name
//   - sets `lab_test_id` (the FK)
//   - pre-fills `instructions` from the catalog row if it has them
//     AND the row's instructions field is currently empty (doctor's
//     edits win — we never overwrite typed instructions)
//
// Free-text fallback: every keystroke calls onChange(value), so a
// row's test_name stays in sync even when the doctor types a test
// not in the catalog. lab_test_id stays null in that case; the
// server action persists it as a free-text row.

import { useEffect, useRef, useState } from "react";
import { Loader2, FlaskConical } from "lucide-react";

export type LabTestSearchResult = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  method: string | null;
  sample: string | null;
  tat: string | null;
  price_paise: number | null;
  instructions: string | null;
};

export type LabTestAutocompleteProps = {
  value: string;
  onChange: (v: string) => void;
  onPickCatalog: (picked: LabTestSearchResult) => void;
  /** Override the visible label above the input. Defaults to "Test". */
  label?: string;
  /** Hide the label (e.g. in a compact drawer where the column
   *  header carries the label). */
  hideLabel?: boolean;
  /** Search debounce in ms. Per brief: 150 ms (snappier than
   *  drug autocomplete's 200 ms — lab field is the v3 smoke-test
   *  bottleneck). */
  debounceMs?: number;
  /** Max suggestions to fetch. API caps at 50; brief recommends 12
   *  to keep the dropdown surface readable in the drawer. */
  limit?: number;
  required?: boolean;
  placeholder?: string;
  inputClassName?: string;
};

function formatPaiseAsRupees(paise: number | null): string | null {
  if (paise == null) return null;
  const rupees = paise / 100;
  // Whole-rupee prices print without decimals; non-whole keep two.
  if (Number.isInteger(rupees)) return `₹${rupees.toLocaleString("en-IN")}`;
  return `₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function LabTestAutocomplete({
  value,
  onChange,
  onPickCatalog,
  label = "Test",
  hideLabel = false,
  debounceMs = 150,
  limit = 12,
  required = false,
  placeholder = "Lipid Profile, CBC, BC0573…",
  inputClassName,
}: LabTestAutocompleteProps) {
  const [results, setResults] = useState<LabTestSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // Track latest in-flight request so out-of-order responses don't
  // overwrite a fresher result set (doctor types fast).
  const reqIdRef = useRef(0);

  // Debounced fetch. Only fires when value.length >= 2 (matches the
  // API's MIN_QUERY_LEN); shorter queries clear the dropdown.
  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const myReqId = ++reqIdRef.current;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/doctor/lab-tests/search?q=${encodeURIComponent(
            trimmed,
          )}&limit=${limit}`,
          { cache: "no-store" },
        );
        const data = (await res.json().catch(() => ({}))) as {
          results?: LabTestSearchResult[];
        };
        if (myReqId !== reqIdRef.current) return;
        setResults(data.results ?? []);
      } catch {
        if (myReqId !== reqIdRef.current) return;
        setResults([]);
      } finally {
        if (myReqId === reqIdRef.current) setLoading(false);
      }
    }, debounceMs);
    return () => clearTimeout(handle);
  }, [value, debounceMs, limit]);

  // Close on click-outside.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const inputEl = (
    <input
      type="text"
      value={value}
      required={required}
      placeholder={placeholder}
      onChange={(e) => {
        onChange(e.target.value);
        setOpen(true);
      }}
      onFocus={() => {
        if (value.trim().length >= 2) setOpen(true);
      }}
      autoComplete="off"
      className={
        inputClassName ??
        "w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
      }
    />
  );

  return (
    <div ref={wrapperRef} className="relative">
      {!hideLabel ? (
        <label className="block">
          <span className="block text-xs font-medium text-slate-700 mb-1">
            {label}
          </span>
          {inputEl}
        </label>
      ) : (
        inputEl
      )}

      {open && (results.length > 0 || loading) && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-80 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
          {loading && results.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-slate-500 px-3 py-2">
              <Loader2 className="w-3 h-3 animate-spin" /> Searching catalog…
            </div>
          )}
          {results.map((r) => {
            const price = formatPaiseAsRupees(r.price_paise);
            // Subtitle line: sample · TAT · price, filtered to
            // non-null pieces so empty fields don't render orphan dots.
            const subtitleParts: string[] = [];
            if (r.sample) {
              // Trim long sample descriptions ("3 mL (1.5 mL min.) Serum (Red Top)")
              // to a readable head in the dropdown.
              const sampleShort = r.sample.length > 32 ? r.sample.slice(0, 32) + "…" : r.sample;
              subtitleParts.push(sampleShort);
            }
            if (r.tat) subtitleParts.push(`TAT ${r.tat}`);
            if (price) subtitleParts.push(price);

            return (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  onPickCatalog(r);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 focus:bg-slate-50 focus:outline-none"
              >
                <div className="flex items-start gap-2">
                  <FlaskConical className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    {/* Line 1: bold name (left), category + code (right, muted) */}
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="text-sm font-medium text-slate-900 truncate">
                        {r.name}
                      </div>
                      <div className="text-[11px] text-slate-500 shrink-0 whitespace-nowrap">
                        {r.category ? `${r.category} · ` : ""}
                        <span className="font-mono">{r.code}</span>
                      </div>
                    </div>
                    {/* Line 2: sample + TAT + price */}
                    {subtitleParts.length > 0 && (
                      <div className="text-[11px] text-slate-600 truncate mt-0.5">
                        {subtitleParts.join(" · ")}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
