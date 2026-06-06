"use client";

// The interactive /pulse/medications surface. Top to bottom (per the mockup):
//   1. Import banner — a recent, unimported Sanocare Rx the patient can pull in.
//   2. Adherence card — last-30-day "92% (28/30)" ring + per-med breakdown.
//   3. Today's schedule — every dose due today; tap the circle to mark it taken.
//   4. Active medications — dose/frequency, refill warning, "Review" pill on
//      lossy imports; tap a row to open its detail (history / edit / end).
//
// All data is fetched from the Pulse API on mount and re-pulled after any
// mutation, so the schedule, adherence ring and active list stay consistent.

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Check,
  Pill,
  FileText,
  Loader2,
  ChevronRight,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";

import { formatIST } from "@/lib/time/formatIST";
import { PulseStickyBar } from "../_components/PulseStickyBar";
import { AddMedicationSheet } from "../_components/AddMedicationSheet";
import { MedDetailSheet } from "../_components/MedDetailSheet";
import { pulseFetch } from "../_lib/pulseClient";
import type {
  AdherenceResponse,
  ImportableRx,
  Medication,
  ScheduledDose,
} from "../_lib/pulseTypes";
import {
  doseVisual,
  formatAdherence,
  refillStatus,
  scheduleSummary,
} from "../_lib/medsDisplay";

export function MedicationsSurface() {
  const [meds, setMeds] = useState<Medication[]>([]);
  const [schedule, setSchedule] = useState<ScheduledDose[]>([]);
  const [adherence, setAdherence] = useState<AdherenceResponse | null>(null);
  const [importable, setImportable] = useState<ImportableRx | null>(null);
  const [loading, setLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [detailMed, setDetailMed] = useState<Medication | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const [m, s, a, rx] = await Promise.all([
      pulseFetch<{ medications?: Medication[] }>(
        "/api/pulse/medications?active=true",
      ),
      pulseFetch<{ doses?: ScheduledDose[] }>("/api/pulse/medications/schedule"),
      pulseFetch<AdherenceResponse>(
        "/api/pulse/medications/adherence?window=30d",
      ),
      pulseFetch<{ importable?: ImportableRx | null }>(
        "/api/pulse/medications/importable-rx",
      ),
    ]);
    if (m.ok && m.data.medications) setMeds(m.data.medications);
    if (s.ok && s.data.doses) setSchedule(s.data.doses);
    if (a.ok) setAdherence(a.data);
    setImportable(rx.ok ? (rx.data.importable ?? null) : null);
    setLoading(false);
  }, []);

  const refreshScheduleAndAdherence = useCallback(async () => {
    const [s, a] = await Promise.all([
      pulseFetch<{ doses?: ScheduledDose[] }>("/api/pulse/medications/schedule"),
      pulseFetch<AdherenceResponse>(
        "/api/pulse/medications/adherence?window=30d",
      ),
    ]);
    if (s.ok && s.data.doses) setSchedule(s.data.doses);
    if (a.ok) setAdherence(a.data);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function markDose(dose: ScheduledDose) {
    const next = dose.state === "taken" ? "pending" : "taken";
    // Optimistic flip.
    setSchedule((prev) =>
      prev.map((d) =>
        d.intake_id === dose.intake_id
          ? {
              ...d,
              state: next,
              taken_at: next === "taken" ? new Date().toISOString() : null,
            }
          : d,
      ),
    );
    const { ok } = await pulseFetch(
      `/api/pulse/medications/${dose.medication_id}/intake`,
      {
        method: "POST",
        body: JSON.stringify({ scheduled_at: dose.scheduled_at, state: next }),
      },
    );
    if (ok) {
      void refreshScheduleAndAdherence();
    } else {
      void loadAll(); // reconcile on failure
    }
  }

  async function handleImport() {
    if (!importable || importing) return;
    setImporting(true);
    setImportError(null);
    const { ok, data } = await pulseFetch<{ error?: string }>(
      `/api/pulse/medications/import-from-rx?rx_id=${encodeURIComponent(
        importable.id,
      )}`,
      { method: "POST" },
    );
    setImporting(false);
    if (!ok) {
      setImportError(
        data.error || "Could not import the prescription. Try again.",
      );
      return;
    }
    await loadAll();
  }

  const noMeds = !loading && meds.length === 0;

  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      <div className="mx-auto max-w-2xl px-4 pt-4">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-sm text-text-secondary">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : noMeds ? (
          <EmptyMeds
            importable={importable}
            importing={importing}
            onImport={handleImport}
            onAdd={() => setAddOpen(true)}
          />
        ) : (
          <>
            {importable && (
              <ImportBanner
                rx={importable}
                importing={importing}
                error={importError}
                onImport={handleImport}
              />
            )}

            {adherence && <AdherenceCard adherence={adherence} />}

            <SectionHeader title="Today's schedule" />
            {schedule.length === 0 ? (
              <div className="rounded-2xl bg-white p-5 text-center text-sm text-text-secondary shadow-sm">
                No doses scheduled for today.
              </div>
            ) : (
              <div className="rounded-2xl bg-white p-2 shadow-sm">
                {schedule.map((dose) => (
                  <DoseRow
                    key={dose.intake_id}
                    dose={dose}
                    onMark={() => markDose(dose)}
                  />
                ))}
              </div>
            )}

            <SectionHeader title="Active medications" />
            <div className="space-y-2">
              {meds.map((med) => (
                <MedRow
                  key={med.id}
                  med={med}
                  onOpen={() => setDetailMed(med)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <PulseStickyBar onClick={() => setAddOpen(true)} ariaLabel="Add medication">
        <Plus className="h-4 w-4" />
        Add medication
      </PulseStickyBar>

      <AddMedicationSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => {
          setAddOpen(false);
          void loadAll();
        }}
      />
      <MedDetailSheet
        open={detailMed !== null}
        medication={detailMed}
        onClose={() => setDetailMed(null)}
        onChanged={() => void loadAll()}
      />
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="mb-2 ml-1 mt-5 text-sm font-bold text-text-main">{title}</h2>
  );
}

function ImportBanner({
  rx,
  importing,
  error,
  onImport,
}: {
  rx: ImportableRx;
  importing: boolean;
  error: string | null;
  onImport: () => void;
}) {
  return (
    <div className="mb-3 rounded-2xl border border-[color:var(--color-accent-coral)]/40 bg-accent-coral-50 p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-coral text-white">
          <FileText className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold text-text-main">
            Import your prescription
          </div>
          <div className="text-xs text-text-secondary">
            {rx.doctor_name ? `From Dr ${rx.doctor_name}` : "From your doctor"}
            {rx.sent_at ? `, ${formatIST(rx.sent_at, "date")}` : ""} ·{" "}
            {rx.item_count} {rx.item_count === 1 ? "med" : "meds"}
          </div>
        </div>
        <button
          type="button"
          onClick={onImport}
          disabled={importing}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent-coral px-3.5 py-2 text-xs font-bold text-white disabled:opacity-60"
        >
          {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Import
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
    </div>
  );
}

function AdherenceCard({ adherence }: { adherence: AdherenceResponse }) {
  const { taken, missed, overdue_pending, rate } = adherence.overall;
  const due = taken + missed + overdue_pending;
  const pct = rate == null ? 0 : Math.round(rate * 100);
  const ringStyle = {
    background: `conic-gradient(#ffffff 0 ${pct}%, rgba(255,255,255,0.25) ${pct}% 100%)`,
  };

  return (
    <div className="mb-3 flex items-center gap-4 rounded-2xl bg-gradient-to-br from-primary to-primary-dark p-4 text-white">
      <div
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full"
        style={ringStyle}
      >
        <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-primary text-sm font-bold">
          {rate == null ? "—" : `${pct}%`}
        </div>
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-white/80">
          Adherence — last 30 days
        </div>
        <div className="mt-0.5 text-base font-bold">
          {formatAdherence(rate, taken, due)}
        </div>
        <div className="mt-0.5 text-xs text-white/85">
          {due === 0
            ? "Mark doses as you take them to start tracking."
            : `${taken} of ${due} doses · ${missed + overdue_pending} missed`}
        </div>
      </div>
    </div>
  );
}

function DoseRow({
  dose,
  onMark,
}: {
  dose: ScheduledDose;
  onMark: () => void;
}) {
  const visual = doseVisual(dose);
  const checkCls =
    visual === "taken"
      ? "border-emerald-600 bg-emerald-600 text-white"
      : visual === "missed"
        ? "border-rose-400 bg-rose-50"
        : "border-slate-300 bg-white";

  return (
    <div className="flex items-center gap-3 px-2 py-2.5">
      <button
        type="button"
        onClick={onMark}
        aria-label={visual === "taken" ? "Mark as not taken" : "Mark as taken"}
        className={
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors " +
          checkCls
        }
      >
        {visual === "taken" && <Check className="h-4 w-4" />}
      </button>
      <div className="flex-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
          {formatIST(dose.scheduled_at, "time")}
          {visual === "missed" ? " · missed" : ""}
          {visual === "taken" ? " · taken" : ""}
        </div>
        <div
          className={
            "text-sm font-semibold " +
            (visual === "missed"
              ? "text-slate-400 line-through decoration-2 decoration-rose-400"
              : "text-text-main")
          }
        >
          {dose.name}{" "}
          <span
            className={
              "font-normal " + (visual === "missed" ? "" : "text-text-secondary")
            }
          >
            {dose.dose}
          </span>
        </div>
      </div>
    </div>
  );
}

function MedRow({ med, onOpen }: { med: Medication; onOpen: () => void }) {
  const refill = refillStatus(med);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary">
        <Pill className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-text-main">{med.name}</span>
          {med.imported_needs_review && (
            <span className="inline-flex items-center gap-1 rounded-md bg-accent-coral-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--color-accent-coral-dark)]">
              <RotateCcw className="h-3 w-3" />
              Review
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-text-secondary">
          {scheduleSummary(med)}
        </div>
        {refill.warn && (
          <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600">
            <AlertTriangle className="h-3 w-3" />
            {refill.daysLeft != null
              ? `Refill soon — about ${refill.daysLeft} day${
                  refill.daysLeft === 1 ? "" : "s"
                } left`
              : "Refill soon"}
          </div>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
    </button>
  );
}

function EmptyMeds({
  importable,
  importing,
  onImport,
  onAdd,
}: {
  importable: ImportableRx | null;
  importing: boolean;
  onImport: () => void;
  onAdd: () => void;
}) {
  return (
    <div className="mt-10 rounded-3xl bg-white p-8 text-center shadow-sm">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary">
        <Pill className="h-7 w-7" />
      </div>
      <p className="mx-auto mt-4 max-w-xs text-sm leading-relaxed text-text-secondary">
        Keep every medicine in one place — schedules, doses, and a tap to mark
        each one taken.
      </p>

      {importable ? (
        <>
          <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-text-main">
            We found a prescription from{" "}
            {importable.doctor_name
              ? `Dr ${importable.doctor_name}`
              : "your doctor"}
            {importable.sent_at
              ? `, ${formatIST(importable.sent_at, "date")}`
              : ""}
            . Import it to set up your schedule in one tap.
          </p>
          <button
            type="button"
            onClick={onImport}
            disabled={importing}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-accent-coral px-5 py-3 text-sm font-bold text-white shadow-lg shadow-[color:var(--color-accent-coral)]/30 disabled:opacity-60"
          >
            {importing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            Import from prescription
          </button>
          <button
            type="button"
            onClick={onAdd}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-100 px-5 py-3 text-sm font-bold text-text-main hover:bg-slate-200"
          >
            <Plus className="h-4 w-4" />
            Add manually
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-lg shadow-primary/30"
        >
          <Plus className="h-4 w-4" />
          Add your first medication
        </button>
      )}
    </div>
  );
}
