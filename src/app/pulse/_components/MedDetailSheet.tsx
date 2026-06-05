"use client";

// Medication detail sheet: confirm/edit the schedule, see intake history, and
// end the course. For Rx-imported meds flagged imported_needs_review this is
// the "Review" destination — a coral callout explains the schedule was guessed,
// and saving the schedule clears the flag (the API drops the review pill and
// regenerates future pending doses to match).

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X, Loader2, Check, AlertCircle, History, Square } from "lucide-react";

import { formatIST } from "@/lib/time/formatIST";
import { pulseFetch } from "../_lib/pulseClient";
import {
  defaultTimesFor,
  istTodayYMDClient,
} from "../_lib/medsDisplay";
import type { IntakeState, Medication } from "../_lib/pulseTypes";

interface IntakeRow {
  id: string;
  scheduled_at: string;
  taken_at: string | null;
  state: IntakeState;
}

const STATE_LABEL: Record<IntakeState, string> = {
  taken: "Taken",
  pending: "Pending",
  skipped: "Skipped",
  missed: "Missed",
};

export function MedDetailSheet({
  open,
  medication,
  onClose,
  onChanged,
}: {
  open: boolean;
  medication: Medication | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();

  const [dose, setDose] = useState("");
  const [freqLabel, setFreqLabel] = useState("");
  const [times, setTimes] = useState<string[]>([]);
  const [supply, setSupply] = useState("");
  const [threshold, setThreshold] = useState("");
  const [saving, setSaving] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<IntakeRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!open || !medication) return;
    setDose(medication.dose);
    setFreqLabel(medication.frequency_label);
    setTimes(
      medication.scheduled_times && medication.scheduled_times.length > 0
        ? medication.scheduled_times
        : defaultTimesFor(medication.times_per_day),
    );
    setSupply(medication.supply_qty != null ? String(medication.supply_qty) : "");
    setThreshold(
      medication.refill_warning_threshold_days != null
        ? String(medication.refill_warning_threshold_days)
        : "",
    );
    setError(null);

    // Load recent intake history.
    setHistoryLoading(true);
    (async () => {
      const { ok, data } = await pulseFetch<{ intake?: IntakeRow[] }>(
        `/api/pulse/medications/${medication.id}/intake`,
      );
      if (ok && data.intake) {
        // Newest first, cap to a readable window.
        setHistory([...data.intake].reverse().slice(0, 12));
      }
      setHistoryLoading(false);
    })();
  }, [open, medication]);

  if (!medication) return null;

  function setTimeAt(i: number, value: string) {
    setTimes((prev) => prev.map((t, idx) => (idx === i ? value : t)));
  }

  async function handleSave() {
    if (saving || !medication) return;
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      dose: dose.trim() || medication.dose,
      frequency_label: freqLabel.trim() || medication.frequency_label,
      times_per_day: times.length,
      scheduled_times: times,
    };
    if (supply.trim() !== "" && Number.isFinite(Number(supply))) {
      body.supply_qty = Math.floor(Number(supply));
    }
    if (threshold.trim() !== "" && Number.isFinite(Number(threshold))) {
      body.refill_warning_threshold_days = Math.floor(Number(threshold));
    }
    try {
      const { ok, data } = await pulseFetch<{ error?: string }>(
        `/api/pulse/medications/${medication.id}`,
        { method: "PATCH", body: JSON.stringify(body) },
      );
      if (!ok) {
        setError(data.error || "Could not save changes. Try again.");
        return;
      }
      onChanged();
      onClose();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleEnd() {
    if (ending || !medication) return;
    setEnding(true);
    setError(null);
    try {
      const { ok, data } = await pulseFetch<{ error?: string }>(
        `/api/pulse/medications/${medication.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ end_date: istTodayYMDClient() }),
        },
      );
      if (!ok) {
        setError(data.error || "Could not end this medication. Try again.");
        return;
      }
      onChanged();
      onClose();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setEnding(false);
    }
  }

  const needsReview = medication.imported_needs_review;

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
            aria-label={`${medication.name} details`}
            className="relative flex h-full w-full flex-col overflow-y-auto bg-white sm:h-auto sm:max-h-[92vh] sm:max-w-md sm:rounded-3xl sm:shadow-2xl"
            initial={prefersReducedMotion ? false : { y: "100%", opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
              <div>
                <h2 className="text-base font-bold text-text-main">
                  {medication.name}
                </h2>
                <p className="text-xs text-text-secondary">
                  {medication.dose} ·{" "}
                  {medication.source === "rx_import"
                    ? "imported from Rx"
                    : "added manually"}
                </p>
              </div>
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
              {needsReview && (
                <div className="mb-4 rounded-xl border border-[color:var(--color-accent-coral)]/40 bg-accent-coral-50 p-3 text-xs leading-relaxed text-text-secondary">
                  We guessed the schedule from your prescription. Confirm the
                  dose times or refill threshold below — saving clears the review
                  flag.
                </div>
              )}

              <Field label="Dose">
                <input
                  type="text"
                  value={dose}
                  onChange={(e) => setDose(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Frequency">
                <input
                  type="text"
                  value={freqLabel}
                  onChange={(e) => setFreqLabel(e.target.value)}
                  className={inputCls}
                />
              </Field>
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

              <div className="flex gap-3">
                <Field label="Tablets left" className="flex-1">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={supply}
                    placeholder="—"
                    onChange={(e) => setSupply(e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Warn at (days)" className="flex-1">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={threshold}
                    placeholder="5"
                    onChange={(e) => setThreshold(e.target.value)}
                    className={inputCls}
                  />
                </Field>
              </div>

              {error && (
                <div className="mb-4 flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Intake history */}
              <div className="mt-2">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-text-secondary">
                  <History className="h-3.5 w-3.5" />
                  Recent doses
                </div>
                {historyLoading ? (
                  <div className="flex items-center gap-2 py-3 text-sm text-text-secondary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </div>
                ) : history.length === 0 ? (
                  <p className="py-2 text-sm text-text-secondary">
                    No doses recorded yet.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100 rounded-xl bg-slate-50">
                    {history.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-center justify-between px-3 py-2 text-xs"
                      >
                        <span className="text-text-secondary">
                          {formatIST(row.scheduled_at, "datetime")}
                        </span>
                        <span
                          className={
                            "font-semibold " +
                            (row.state === "taken"
                              ? "text-emerald-600"
                              : row.state === "missed"
                                ? "text-rose-600"
                                : "text-slate-400")
                          }
                        >
                          {STATE_LABEL[row.state]}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* End medication */}
              <button
                type="button"
                onClick={handleEnd}
                disabled={ending}
                className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 hover:underline disabled:opacity-50"
              >
                {ending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                End this medication today
              </button>
            </div>

            <div className="sticky bottom-0 border-t border-slate-100 bg-white px-5 py-4">
              <button
                type="button"
                disabled={saving}
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
                    {needsReview ? "Confirm schedule" : "Save changes"}
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
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={"mb-4 " + (className ?? "")}>
      <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-text-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}
