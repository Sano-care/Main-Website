"use client";

// Shared autocomplete for medication brand / composition lookup.
//
// First built inline in the legacy direct-link composer
// (src/app/doctor/(shell)/sessions/[session_id]/prescribe/
// PrescriptionComposer.tsx) under C2-Rx v7; extracted here in v3 so
// the in-call drawer composer can reuse the exact same UX.
//
// Behaviour
// ---------
// Doctor types brand name OR composition keyword (e.g. "omeprazole"),
// the component debounces (200 ms) and queries /api/doctor/medicines/
// search (kept at this path per Q3 sign-off), then renders the top
// N matches as a dropdown below the input. Each result shows three
// lines:
//   Brand       — medicine_catalog.brand_name
//   Form        — Tablet / Capsule / Syrup / etc.
//   Composition — active ingredients + per-ingredient strengths
//
// On pick: brand_name fills `drug_name`, the catalog `strength`
// (if non-empty) fills `dose`, and the catalog row id and sku are
// returned to the parent via onPickCatalog so the FK can land on
// prescription_items.medicine_sku (M026).
//
// Freetext fallback: every keystroke fires onChange(value) so the
// parent's drug_name stays in sync even when the doctor types
// something not in the catalog. The autocomplete is purely a
// suggestion layer — submission is never blocked by a no-match.

import { useEffect, useRef, useState } from "react";
import { Loader2, Pill } from "lucide-react";

export type MedicineSearchResult = {
  id: string;
  sku: number | null;
  brand_name: string;
  strength: string | null;
  form: string | null;
  composition: string;
};

export type DrugAutocompleteProps = {
  value: string;
  onChange: (v: string) => void;
  onPickCatalog: (picked: MedicineSearchResult) => void;
  /** Override the visible label above the input.
   *  Defaults to "Drug *". */
  label?: string;
  /** Hide the label (e.g. in a compact drawer where the column header
   *  carries the label). */
  hideLabel?: boolean;
  /** Default search debounce in ms. Bump for slower APIs. */
  debounceMs?: number;
  /** Max number of suggestions to fetch. The API caps at its own
   *  configured limit, so this is a hint. */
  limit?: number;
  required?: boolean;
  placeholder?: string;
  /** Optional extra class for the input. */
  inputClassName?: string;
};

export function DrugAutocomplete({
  value,
  onChange,
  onPickCatalog,
  label = "Drug *",
  hideLabel = false,
  debounceMs = 200,
  limit = 20,
  required = true,
  placeholder,
  inputClassName,
}: DrugAutocompleteProps) {
  const [results, setResults] = useState<MedicineSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // Track the latest in-flight request so out-of-order responses
  // don't overwrite a fresher result set (doctor types fast).
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
          `/api/doctor/medicines/search?q=${encodeURIComponent(
            trimmed,
          )}&limit=${limit}`,
          { cache: "no-store" },
        );
        const data = (await res.json().catch(() => ({}))) as {
          results?: MedicineSearchResult[];
        };
        // Drop stale responses.
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

  // Close on click-outside. Standard pattern — listen on document,
  // check whether the click target is inside our wrapper.
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

  return (
    <div ref={wrapperRef} className="relative">
      {!hideLabel ? (
        <label className="block">
          <span className="block text-xs font-medium text-slate-700 mb-1">
            {label}
          </span>
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
            // autocomplete=off so the browser's password-manager /
            // form-autofill suggestions don't fight our dropdown.
            autoComplete="off"
            className={
              inputClassName ??
              "w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            }
          />
        </label>
      ) : (
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
      )}

      {open && (results.length > 0 || loading) && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
          {loading && results.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-slate-500 px-3 py-2">
              <Loader2 className="w-3 h-3 animate-spin" /> Searching catalog…
            </div>
          )}
          {results.map((r) => (
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
                <Pill className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">
                    {r.brand_name}
                    {r.strength ? (
                      <span className="ml-1.5 text-xs font-normal text-slate-500">
                        {r.strength}
                      </span>
                    ) : null}
                  </div>
                  {r.form && (
                    <div className="text-[11px] text-slate-500">{r.form}</div>
                  )}
                  <div className="text-[11px] text-slate-600 truncate">
                    {r.composition}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
