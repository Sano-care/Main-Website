"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";

import { pulseFetch } from "@/app/pulse/_lib/pulseClient";
import { VITAL_KIND_ORDER, VITAL_META } from "@/app/pulse/_lib/vitalsDisplay";
import type { VitalKind } from "@/app/api/pulse/_lib/validation";
import ModalShell from "./ModalShell";

// R2b — patient "Log a reading" modal on the records Vitals detail. JSON POST to
// /api/pulse/vitals (account-level: NO member selector; the route forces
// source='manual'). Kinds come from the canonical VITAL_KIND_ORDER; BP shows a
// second (diastolic) field via VITAL_META.hasSecondary. Mounts fresh each open.

function localNowInput(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export default function AddVitalModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  if (!open) return null;
  return <VitalForm onClose={onClose} onSaved={onSaved} />;
}

function VitalForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<VitalKind>(VITAL_KIND_ORDER[0]);
  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [takenAt, setTakenAt] = useState(localNowInput());
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = VITAL_META[kind];
  const canSave =
    primary.trim() !== "" &&
    Number.isFinite(Number(primary)) &&
    (!meta.hasSecondary || (secondary.trim() !== "" && Number.isFinite(Number(secondary)))) &&
    takenAt !== "" &&
    !submitting;

  async function handleSave() {
    if (!canSave) return;
    setSubmitting(true);
    setError(null);

    const body: Record<string, unknown> = {
      kind,
      value_numeric: Number(primary),
      taken_at: new Date(takenAt).toISOString(),
    };
    if (meta.hasSecondary) body.value_secondary = Number(secondary);
    if (note.trim() !== "") body.context_note = note.trim();

    const { ok, data } = await pulseFetch<{ error?: string }>("/api/pulse/vitals", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!ok) {
      setError(data.error || "Couldn't save the reading. Please try again.");
      setSubmitting(false);
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <ModalShell
      title="Log a reading"
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
              <Plus className="h-4 w-4" /> Log reading
            </>
          )}
        </button>
      }
    >
      <label className="block">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
          Reading
        </span>
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as VitalKind);
            setSecondary("");
          }}
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
        >
          {VITAL_KIND_ORDER.map((k) => (
            <option key={k} value={k}>
              {VITAL_META[k].label}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
            {meta.hasSecondary ? "Systolic" : "Value"}
            {meta.unit ? <span className="font-normal normal-case"> ({meta.unit})</span> : null}
          </span>
          <input
            type="number"
            inputMode="decimal"
            autoFocus
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-mono text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </label>

        {meta.hasSecondary ? (
          <label className="block">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
              Diastolic
            </span>
            <input
              type="number"
              inputMode="decimal"
              value={secondary}
              onChange={(e) => setSecondary(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-mono text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </label>
        ) : null}
      </div>

      <label className="mt-3 block">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
          When
        </span>
        <input
          type="datetime-local"
          value={takenAt}
          max={localNowInput()}
          onChange={(e) => setTakenAt(e.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
      </label>

      <label className="mt-3 block">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
          Note <span className="font-normal normal-case">(optional)</span>
        </span>
        <input
          type="text"
          value={note}
          maxLength={500}
          placeholder="e.g. after a walk"
          onChange={(e) => setNote(e.target.value)}
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
