"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";

import { pulseFetch } from "@/app/pulse/_lib/pulseClient";
import ModalShell from "./ModalShell";

// R2b — patient "Add a medication" modal on the records Medications detail. JSON
// POST to /api/pulse/medications (account-level: NO member selector; the route's
// createMedication writer forces source='manual' + seeds the intake log).
// scheduled_times is left to the route's per-times_per_day defaults this slice
// (the dedicated /pulse/medications page owns the explicit times editor).

function localTodayYMD(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

const FREQUENCY_OPTIONS = [
  "Once daily",
  "Twice daily",
  "Three times daily",
  "Four times daily",
  "As needed",
];

export default function AddMedicationModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  if (!open) return null;
  return <MedicationForm onClose={onClose} onSaved={onSaved} />;
}

function MedicationForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [frequencyLabel, setFrequencyLabel] = useState(FREQUENCY_OPTIONS[0]);
  const [timesPerDay, setTimesPerDay] = useState(1);
  const [startDate, setStartDate] = useState(localTodayYMD());
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave =
    name.trim() !== "" && dose.trim() !== "" && frequencyLabel.trim() !== "" && !submitting;

  async function handleSave() {
    if (!canSave) return;
    setSubmitting(true);
    setError(null);

    const body: Record<string, unknown> = {
      name: name.trim(),
      dose: dose.trim(),
      frequency_label: frequencyLabel.trim(),
      times_per_day: timesPerDay,
      start_date: startDate,
    };
    if (endDate) body.end_date = endDate;
    if (reason.trim() !== "") body.reason = reason.trim();

    const { ok, data } = await pulseFetch<{ error?: string }>("/api/pulse/medications", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!ok) {
      setError(data.error || "Couldn't save the medication. Please try again.");
      setSubmitting(false);
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <ModalShell
      title="Add a medication"
      onClose={onClose}
      busy={submitting}
      footer={
        <button
          type="button"
          disabled={!canSave}
          onClick={handleSave}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" /> Add medication
            </>
          )}
        </button>
      }
    >
      <label className="block">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
          Medicine
        </span>
        <input
          type="text"
          autoFocus
          value={name}
          maxLength={120}
          placeholder="e.g. Metformin"
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
      </label>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
            Dose
          </span>
          <input
            type="text"
            value={dose}
            maxLength={80}
            placeholder="e.g. 500 mg"
            onChange={(e) => setDose(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </label>

        <label className="block">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
            How often
          </span>
          <select
            value={frequencyLabel}
            onChange={(e) => {
              const v = e.target.value;
              setFrequencyLabel(v);
              const idx = FREQUENCY_OPTIONS.indexOf(v);
              // Once/Twice/Three/Four → 1..4; "As needed" → 0.
              setTimesPerDay(idx >= 0 && idx <= 3 ? idx + 1 : 0);
            }}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          >
            {FREQUENCY_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
            Start
          </span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </label>

        <label className="block">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
            End <span className="font-normal normal-case">(optional)</span>
          </span>
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
          What for <span className="font-normal normal-case">(optional)</span>
        </span>
        <input
          type="text"
          value={reason}
          maxLength={300}
          placeholder="e.g. blood sugar"
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
      </label>

      {error ? (
        <p className="mt-3 text-sm text-rose-600" role="alert">
          {error}
        </p>
      ) : null}
    </ModalShell>
  );
}
