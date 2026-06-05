"use client";

// Add-a-medication sheet (manual entry). Full-screen on mobile, card on
// desktop — same shell as AddVitalSheet. The patient names the medicine, its
// dose, how many times a day, and confirms the clock times (pre-filled from the
// same IST defaults the Rx importer uses). On save the API seeds 14 days of
// pending doses, so today's schedule populates immediately.

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X, Loader2, Check, AlertCircle } from "lucide-react";

import { pulseFetch } from "../_lib/pulseClient";
import { defaultTimesFor } from "../_lib/medsDisplay";
import type { Medication } from "../_lib/pulseTypes";

const FREQ_PRESETS = [
  { times: 1, label: "Once daily" },
  { times: 2, label: "Twice daily" },
  { times: 3, label: "Thrice daily" },
  { times: 4, label: "Four times" },
];

export function AddMedicationSheet({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (med: Medication) => void;
}) {
  const prefersReducedMotion = useReducedMotion();

  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [timesPerDay, setTimesPerDay] = useState(2);
  const [times, setTimes] = useState<string[]>(defaultTimesFor(2));
  const [reason, setReason] = useState("");
  const [supply, setSupply] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDose("");
    setTimesPerDay(2);
    setTimes(defaultTimesFor(2));
    setReason("");
    setSupply("");
    setError(null);
    setSaving(false);
  }, [open]);

  function pickFrequency(n: number) {
    setTimesPerDay(n);
    setTimes(defaultTimesFor(n));
  }

  function setTimeAt(i: number, value: string) {
    setTimes((prev) => prev.map((t, idx) => (idx === i ? value : t)));
  }

  const freqLabel =
    FREQ_PRESETS.find((f) => f.times === timesPerDay)?.label ??
    `${timesPerDay}× daily`;

  const canSave = name.trim() !== "" && dose.trim() !== "" && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    const body: Record<string, unknown> = {
      name: name.trim(),
      dose: dose.trim(),
      frequency_label: freqLabel,
      times_per_day: timesPerDay,
      scheduled_times: times,
    };
    if (reason.trim() !== "") body.reason = reason.trim();

    try {
      const { ok, data } = await pulseFetch<{
        medication?: Medication;
        error?: string;
      }>("/api/pulse/medications", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!ok || !data.medication) {
        setError(data.error || "Could not add the medication. Try again.");
        return;
      }

      // If a supply count was entered, persist it via PATCH (POST ignores it).
      if (supply.trim() !== "" && Number.isFinite(Number(supply))) {
        await pulseFetch(`/api/pulse/medications/${data.medication.id}`, {
          method: "PATCH",
          body: JSON.stringify({ supply_qty: Math.floor(Number(supply)) }),
        });
      }

      onSaved(data.medication);
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
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Add a medication"
            className="relative flex h-full w-full flex-col overflow-y-auto bg-white sm:h-auto sm:max-h-[92vh] sm:max-w-md sm:rounded-3xl sm:shadow-2xl"
            initial={prefersReducedMotion ? false : { y: "100%", opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
              <h2 className="text-base font-bold text-text-main">
                Add a medication
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
              <Field label="Medicine name">
                <input
                  type="text"
                  autoFocus
                  placeholder="e.g. Metformin"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputCls}
                />
              </Field>

              <Field label="Dose">
                <input
                  type="text"
                  placeholder="e.g. 500mg"
                  value={dose}
                  onChange={(e) => setDose(e.target.value)}
                  className={inputCls}
                />
              </Field>

              <Field label="How often?">
                <div className="flex flex-wrap gap-2">
                  {FREQ_PRESETS.map((f) => (
                    <button
                      key={f.times}
                      type="button"
                      onClick={() => pickFrequency(f.times)}
                      className={
                        "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
                        (timesPerDay === f.times
                          ? "bg-primary text-white"
                          : "bg-slate-100 text-text-secondary hover:bg-slate-200")
                      }
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </Field>

              {times.length > 0 && (
                <Field label="Dose times (IST)">
                  <div className="flex flex-wrap gap-2">
                    {times.map((t, i) => (
                      <input
                        key={i}
                        type="time"
                        value={t}
                        onChange={(e) => setTimeAt(i, e.target.value)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-text-main outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
                      />
                    ))}
                  </div>
                </Field>
              )}

              <Field label="Reason (optional)">
                <input
                  type="text"
                  placeholder="e.g. blood sugar control"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className={inputCls}
                />
              </Field>

              <Field label="Tablets in hand (optional)">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="e.g. 30 — we'll warn you before you run low"
                  value={supply}
                  onChange={(e) => setSupply(e.target.value)}
                  className={inputCls}
                />
              </Field>

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 border-t border-slate-100 bg-white px-5 py-4">
              <button
                type="button"
                disabled={!canSave}
                onClick={handleSave}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-primary/30 disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Adding…
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Add medication
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

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-text-main outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 placeholder:text-slate-400";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-text-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}
