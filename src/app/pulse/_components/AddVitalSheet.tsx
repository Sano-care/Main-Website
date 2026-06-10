"use client";

// Add-a-reading sheet: full-screen on mobile (thumb-friendly, one reading at a
// time), centred card on desktop. Smart-defaults the kind to the patient's last
// logged kind so the common "same reading again" path is the fastest one — a BP
// from the home tile is: tap "+ Log" (→ /pulse/vitals?add=bp, opens here), type
// the two numbers, tap Save. Well inside the 4-tap target.
//
// "When" defaults to now; a details disclosure lets the patient back-date a
// reading. The native datetime-local control resolves in the device's local
// zone — IST on Indian devices — and we convert to a UTC ISO instant for the
// API. Storage stays UTC; every readback renders through formatIST.

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X, Loader2, Check, AlertCircle } from "lucide-react";

import type { VitalKind } from "@/app/api/pulse/_lib/validation";
import { pulseFetch } from "../_lib/pulseClient";
import {
  VITAL_KIND_ORDER,
  VITAL_META,
} from "../_lib/vitalsDisplay";
import type { VitalReading } from "../_lib/pulseTypes";

/** A Date → value string for <input type="datetime-local"> in local time. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function AddVitalSheet({
  open,
  defaultKind,
  onClose,
  onSaved,
}: {
  open: boolean;
  defaultKind: VitalKind;
  onClose: () => void;
  onSaved: (reading: VitalReading) => void;
}) {
  const prefersReducedMotion = useReducedMotion();

  const [kind, setKind] = useState<VitalKind>(defaultKind);
  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [note, setNote] = useState("");
  const [whenNow, setWhenNow] = useState(true);
  const [whenLocal, setWhenLocal] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = VITAL_META[kind];

  // Re-seed the form each time the sheet opens (kind follows the last-used
  // default; fields reset). Deps intentionally only on `open`.
  useEffect(() => {
    if (!open) return;
    setKind(defaultKind);
    setPrimary("");
    setSecondary("");
    setNote("");
    setWhenNow(true);
    setWhenLocal(toLocalInputValue(new Date()));
    setError(null);
    setSaving(false);
  }, [open, defaultKind]);

  const canSave = useMemo(() => {
    if (primary.trim() === "" || !Number.isFinite(Number(primary))) return false;
    if (meta.hasSecondary) {
      if (secondary.trim() === "" || !Number.isFinite(Number(secondary)))
        return false;
    }
    return true;
  }, [primary, secondary, meta.hasSecondary]);

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);

    const takenAt = whenNow
      ? new Date().toISOString()
      : whenLocal
        ? new Date(whenLocal).toISOString()
        : new Date().toISOString();

    const body: Record<string, unknown> = {
      kind,
      value_numeric: Number(primary),
      taken_at: takenAt,
    };
    if (meta.hasSecondary) body.value_secondary = Number(secondary);
    if (note.trim() !== "") body.context_note = note.trim();

    try {
      const { ok, data } = await pulseFetch<{
        reading?: VitalReading;
        error?: string;
      }>("/api/pulse/vitals", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!ok || !data.reading) {
        setError(data.error || "Could not save the reading. Try again.");
        return;
      }
      onSaved(data.reading);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Scrim */}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Log a vital"
            className="relative flex h-full w-full flex-col overflow-y-auto bg-white sm:h-auto sm:max-h-[90vh] sm:max-w-md sm:rounded-3xl sm:shadow-2xl"
            initial={
              prefersReducedMotion ? false : { y: "100%", opacity: 0.6 }
            }
            animate={{ y: 0, opacity: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            {/* Sheet header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
              <h2 className="text-base font-bold text-text-main">
                Log a vital
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 px-5 py-4">
              {/* Kind picker */}
              <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary">
                What are you logging?
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {VITAL_KIND_ORDER.map((k) => {
                  const active = k === kind;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      className={
                        "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
                        (active
                          ? "bg-primary text-white"
                          : "bg-slate-100 text-text-secondary hover:bg-slate-200")
                      }
                    >
                      {VITAL_META[k].label}
                    </button>
                  );
                })}
              </div>

              {/* Value input(s) */}
              <div className="mt-5 flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary">
                    {meta.primaryLabel}
                    {meta.unit ? ` (${meta.unit})` : ""}
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step={meta.step}
                    autoFocus
                    placeholder={meta.placeholder}
                    value={primary}
                    onChange={(e) => setPrimary(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-lg font-semibold text-text-main outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
                  />
                </div>
                {meta.hasSecondary && (
                  <>
                    <span className="pb-3 text-2xl font-light text-slate-300">
                      /
                    </span>
                    <div className="flex-1">
                      <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary">
                        {meta.secondaryLabel}
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        step={meta.step}
                        placeholder={meta.secondaryPlaceholder}
                        value={secondary}
                        onChange={(e) => setSecondary(e.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-lg font-semibold text-text-main outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* When */}
              <div className="mt-5">
                <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary">
                  When
                </label>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setWhenNow(true)}
                    className={
                      "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
                      (whenNow
                        ? "bg-primary text-white"
                        : "bg-slate-100 text-text-secondary hover:bg-slate-200")
                    }
                  >
                    Now
                  </button>
                  <button
                    type="button"
                    onClick={() => setWhenNow(false)}
                    className={
                      "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
                      (!whenNow
                        ? "bg-primary text-white"
                        : "bg-slate-100 text-text-secondary hover:bg-slate-200")
                    }
                  >
                    Earlier
                  </button>
                </div>
                {!whenNow && (
                  <input
                    type="datetime-local"
                    value={whenLocal}
                    max={toLocalInputValue(new Date())}
                    onChange={(e) => setWhenLocal(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-text-main outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
                  />
                )}
              </div>

              {/* Context note */}
              <div className="mt-5">
                <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary">
                  Note <span className="font-normal normal-case">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. after a walk, before breakfast"
                  value={note}
                  maxLength={500}
                  onChange={(e) => setNote(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-text-main outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 placeholder:text-slate-400"
                />
              </div>

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Save */}
            <div className="sticky bottom-0 border-t border-slate-100 bg-white px-5 py-4">
              <button
                type="button"
                disabled={!canSave || saving}
                onClick={handleSave}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-primary/30 disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Save reading
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
