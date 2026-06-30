"use client";

import { useCallback, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Download, Trash2 } from "lucide-react";

import { useViewingFirstName } from "@/app/pulse/_lib/MemberViewingContext";
import { pulseFetch } from "@/app/pulse/_lib/pulseClient";
import type {
  PulseRecords,
  VitalRecord,
  BookingRecord,
  PrescriptionRecord,
  MedicationRecord,
  ConditionRecord,
  AllergyRecord,
  DocumentRecord,
} from "@/lib/pulse/recordsFetch";
import { useRecords } from "./useRecords";
import UploadDocumentModal from "./UploadDocumentModal";
import AddRecordModal from "./AddRecordModal";
import AddVitalModal from "./AddVitalModal";
import AddMedicationModal from "./AddMedicationModal";
import {
  CATEGORY_CONFIG,
  TIER_ICON,
  sourceTag,
  type RecordTileKey,
  type SourceTag,
} from "./categories";
import {
  serviceLabel,
  bookingStatusLabel,
  bookingStatusBadgeClass,
  docTypeLabel,
  formatFileSize,
  conditionStatusLabel,
  severityLabel,
  severityBadgeClass,
  vitalLabel,
  vitalUnit,
  vitalValue,
  formatScheduleTimes,
  formatStatementDay,
  formatStatementTime,
} from "./recordsDisplay";

// R1 — per-category "bank statement" detail screen. Date-wise list, newest
// first, monospace for numbers/dates. Hybrid categories (vitals/medications)
// carry a per-row source tag (You / Home visit). Read-only categories have no
// add control; patient categories surface the add/upload affordance. Reports +
// Invoices are honest empty stubs this slice. Scoped by the viewing member via
// useRecords — no cross-member leakage.

const VITAL_SHORT: Record<string, string> = {
  bp: "BP",
  sugar_fasting: "Sugar (F)",
  sugar_postprandial: "Sugar (PP)",
  sugar_random: "Sugar",
  weight_kg: "Weight",
  temperature_c: "Temp",
  spo2_pct: "SpO₂",
  pulse_bpm: "Pulse",
};

export default function RecordsDetail({ category }: { category: RecordTileKey }) {
  const cfg = CATEGORY_CONFIG[category];
  const { state, viewing, members, initialLoading, stale, reload } = useRecords();
  const viewingName = useViewingFirstName();
  const [addOpen, setAddOpen] = useState(false);

  const subjectLabel = viewing.kind === "self" ? "your" : `${viewingName}'s`;
  const addDefaultMemberId = viewing.kind === "member" ? viewing.member.id : null;
  const tint = TIER_ICON[cfg.tier];
  const Icon = cfg.icon;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-10 pt-3">
      <Link
        href="/pulse/records"
        className="inline-flex items-center gap-1.5 rounded-lg py-1 text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to records
      </Link>

      <header className="mt-2 flex items-center gap-3">
        <span
          className={"flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl " + tint.wrapBg}
          aria-hidden="true"
        >
          <Icon className={"h-6 w-6 [stroke-width:1.8] " + tint.stroke} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-text-main">{cfg.label}</h1>
          <p className="mt-0.5 text-sm text-text-secondary">{cfg.detailSubtitle}</p>
        </div>
      </header>

      <DetailActionControl cfg={cfg} onAdd={() => setAddOpen(true)} />

      <div className="mt-4">
        {initialLoading ? (
          <StatementSkeleton />
        ) : state.status === "error" ? (
          <ErrorCard message={state.message} onRetry={reload} />
        ) : state.status === "ready" ? (
          <>
            {stale ? (
              <p className="mb-2 text-xs text-text-secondary" role="status">
                Updating…
              </p>
            ) : null}
            <CategoryStatement
              category={category}
              records={state.records}
              subjectLabel={subjectLabel}
              onChanged={reload}
            />
          </>
        ) : null}
      </div>

      {/* Documents → upload modal; Conditions/Allergies → add-record modal;
          Vitals/Medications → account-level add modals (no member selector). */}
      {category === "documents" ? (
        <UploadDocumentModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          members={members}
          defaultMemberId={addDefaultMemberId}
          onUploaded={reload}
        />
      ) : category === "conditions" || category === "allergies" ? (
        <AddRecordModal
          open={addOpen}
          category={category}
          onClose={() => setAddOpen(false)}
          members={members}
          defaultMemberId={addDefaultMemberId}
          onSaved={reload}
        />
      ) : category === "vitals" ? (
        <AddVitalModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={reload} />
      ) : category === "medications" ? (
        <AddMedicationModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={reload} />
      ) : null}
    </div>
  );
}

function DetailActionControl({
  cfg,
  onAdd,
}: {
  cfg: (typeof CATEGORY_CONFIG)[RecordTileKey];
  onAdd: () => void;
}) {
  const a = cfg.detailAction;
  if (a.type === "none") return null;

  if (a.type === "link") {
    return (
      <Link
        href={a.href}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3 text-sm font-bold text-white outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Plus className="h-4 w-4" />
        {a.label}
      </Link>
    );
  }
  // "modal" — open an add/upload modal in place.
  return (
    <button
      type="button"
      onClick={onAdd}
      className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3 text-sm font-bold text-white outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <Plus className="h-4 w-4" />
      {a.label}
    </button>
  );
}

function CategoryStatement({
  category,
  records,
  subjectLabel,
  onChanged,
}: {
  category: RecordTileKey;
  records: PulseRecords;
  subjectLabel: string;
  onChanged: () => void;
}) {
  const omitted = (records.accountLevelOmitted as string[]).includes(category);
  if (omitted) {
    return (
      <EmptyCard>
        These are tracked for your whole account. Switch back to yourself (top bar) to see them.
      </EmptyCard>
    );
  }

  switch (category) {
    case "bookings":
      return records.bookings.length ? (
        <Statement>
          {records.bookings.map((b) => (
            <BookingStatementRow key={b.id} booking={b} />
          ))}
        </Statement>
      ) : (
        <EmptyCard>No bookings yet.</EmptyCard>
      );

    case "prescriptions":
      return records.prescriptions.length ? (
        <Statement>
          {records.prescriptions.map((p) => (
            <PrescriptionStatementRow key={p.id} rx={p} />
          ))}
        </Statement>
      ) : (
        <EmptyCard>No prescriptions yet.</EmptyCard>
      );

    case "vitals":
      return records.vitals.length ? (
        <Statement>
          {groupVitalsByTime(records.vitals).map((g) => (
            <VitalStatementRow key={g.takenAt} group={g} onChanged={onChanged} />
          ))}
        </Statement>
      ) : (
        <EmptyCard>No readings yet — log your first to start tracking.</EmptyCard>
      );

    case "medications":
      return records.medications.length ? (
        <Statement>
          {records.medications.map((m) => (
            <MedicationStatementRow key={m.id} med={m} onChanged={onChanged} />
          ))}
        </Statement>
      ) : (
        <EmptyCard>No medications on file.</EmptyCard>
      );

    case "conditions":
      return records.conditions.length ? (
        <Statement>
          {records.conditions.map((c) => (
            <ConditionStatementRow key={c.id} condition={c} onChanged={onChanged} />
          ))}
        </Statement>
      ) : (
        <EmptyCard>No conditions recorded yet.</EmptyCard>
      );

    case "allergies":
      return records.allergies.length ? (
        <Statement>
          {records.allergies.map((a) => (
            <AllergyStatementRow key={a.id} allergy={a} onChanged={onChanged} />
          ))}
        </Statement>
      ) : (
        <EmptyCard>No allergies recorded yet.</EmptyCard>
      );

    case "documents":
      return records.documents.length ? (
        <Statement>
          {records.documents.map((d) => (
            <DocumentStatementRow key={d.id} doc={d} />
          ))}
        </Statement>
      ) : (
        <EmptyCard>
          No documents yet. Use “Upload a document” above to add a report, prescription, or scan.
        </EmptyCard>
      );

    case "reports":
      return (
        <EmptyCard>
          No reports yet. Lab reports from {subjectLabel} Sanocare tests will appear here.
        </EmptyCard>
      );

    case "invoices":
      return (
        <EmptyCard>
          No invoices yet. Receipts for {subjectLabel} visits and tests will appear here.
        </EmptyCard>
      );
  }
}

// ---------------------------------------------------------------------------
// Statement rows — shared grid: date · content · trailing tag/badge.
// ---------------------------------------------------------------------------

function StatementRow({
  day,
  time,
  children,
  trailing,
}: {
  day: string;
  time?: string;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[58px_1fr_auto] items-center gap-2.5 px-3 py-2.5">
      <span className="font-mono text-[11px] leading-tight text-text-secondary">
        {day}
        {time ? (
          <>
            <br />
            {time}
          </>
        ) : null}
      </span>
      <span className="min-w-0">{children}</span>
      {trailing ? <span className="shrink-0">{trailing}</span> : <span />}
    </li>
  );
}

function BookingStatementRow({ booking }: { booking: BookingRecord }) {
  const when = booking.scheduled_for ?? booking.created_at;
  return (
    <StatementRow
      day={formatStatementDay(when)}
      time={formatStatementTime(when)}
      trailing={
        <Badge className={bookingStatusBadgeClass(booking.status)}>
          {bookingStatusLabel(booking.status)}
        </Badge>
      }
    >
      <span className="truncate text-sm font-medium text-text-main">
        {serviceLabel(booking.service_category)}
      </span>
    </StatementRow>
  );
}

function PrescriptionStatementRow({ rx }: { rx: PrescriptionRecord }) {
  const title = rx.doctor_name ? `Dr ${rx.doctor_name}` : "Prescription";
  return (
    <StatementRow
      day={formatStatementDay(rx.sent_at)}
      time={formatStatementTime(rx.sent_at)}
      trailing={
        rx.patient_view_token ? (
          <Link
            href={`/rx/${rx.patient_view_token}`}
            className="rounded-lg bg-primary-50 px-2.5 py-1 text-xs font-bold text-primary hover:bg-blue-100"
          >
            View →
          </Link>
        ) : null
      }
    >
      <span className="block truncate text-sm font-medium text-text-main">Prescription</span>
      <span className="text-xs text-text-secondary">{title}</span>
    </StatementRow>
  );
}

interface VitalGroup {
  takenAt: string;
  source: string | null;
  readings: VitalRecord[];
}

function groupVitalsByTime(vitals: VitalRecord[]): VitalGroup[] {
  // fetchVitals already returns latest-per-kind, newest first. Group readings
  // that share an exact taken_at (i.e. captured together in one home visit /
  // one logging) into a single dated row.
  const groups: VitalGroup[] = [];
  const byTime = new Map<string, VitalGroup>();
  for (const v of vitals) {
    const g = byTime.get(v.taken_at);
    if (g) {
      g.readings.push(v);
    } else {
      const ng: VitalGroup = { takenAt: v.taken_at, source: v.source, readings: [v] };
      byTime.set(v.taken_at, ng);
      groups.push(ng);
    }
  }
  return groups;
}

function VitalStatementRow({ group, onChanged }: { group: VitalGroup; onChanged: () => void }) {
  // Self-entered groups only — every reading at this instant is source='manual'.
  const allManual = group.readings.every((r) => r.source === "manual");
  return (
    <StatementRow
      day={formatStatementDay(group.takenAt)}
      time={formatStatementTime(group.takenAt)}
      trailing={
        <span className="flex items-center gap-1.5">
          <SourceChip tag={sourceTag(group.source)} />
          {allManual ? (
            <DeleteRowButton
              endpoints={group.readings.map((r) => `/api/pulse/vitals/${r.id}`)}
              onDeleted={onChanged}
            />
          ) : null}
        </span>
      }
    >
      <span className="flex flex-wrap gap-1.5">
        {group.readings.map((v) => (
          <span
            key={v.id}
            className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-text-main"
          >
            {VITAL_SHORT[v.kind] ?? vitalLabel(v.kind)}{" "}
            <b className="font-mono">{vitalValue(v)}</b>
            {vitalUnit(v.kind) ? (
              <span className="text-text-secondary"> {vitalUnit(v.kind)}</span>
            ) : null}
          </span>
        ))}
      </span>
    </StatementRow>
  );
}

function MedicationStatementRow({
  med,
  onChanged,
}: {
  med: MedicationRecord;
  onChanged: () => void;
}) {
  const schedule = formatScheduleTimes(med.scheduled_times);
  const sub = [med.dose, schedule].filter(Boolean).join(" · ");
  return (
    <StatementRow
      day={formatStatementDay(med.start_date)}
      trailing={
        <span className="flex items-center gap-1.5">
          <SourceChip tag={sourceTag(med.source)} />
          {med.source === "manual" ? (
            <DeleteRowButton
              endpoints={[`/api/pulse/medications/${med.id}`]}
              onDeleted={onChanged}
            />
          ) : null}
        </span>
      }
    >
      <span className="block truncate text-sm font-medium text-text-main">{med.name}</span>
      {sub ? <span className="text-xs text-text-secondary">{sub}</span> : null}
    </StatementRow>
  );
}

function ConditionStatementRow({
  condition,
  onChanged,
}: {
  condition: ConditionRecord;
  onChanged: () => void;
}) {
  return (
    <StatementRow
      day={formatStatementDay(condition.noted_at ?? condition.created_at)}
      trailing={
        <span className="flex items-center gap-1.5">
          <Badge className="bg-slate-100 text-slate-600">
            {conditionStatusLabel(condition.status)}
          </Badge>
          {condition.source === "patient" ? (
            <DeleteRowButton
              endpoints={[`/api/pulse/conditions?id=${condition.id}`]}
              onDeleted={onChanged}
            />
          ) : null}
        </span>
      }
    >
      <span className="truncate text-sm font-medium text-text-main">{condition.label}</span>
    </StatementRow>
  );
}

function AllergyStatementRow({
  allergy,
  onChanged,
}: {
  allergy: AllergyRecord;
  onChanged: () => void;
}) {
  return (
    <StatementRow
      day={formatStatementDay(allergy.noted_at ?? allergy.created_at)}
      trailing={
        <span className="flex items-center gap-1.5">
          <Badge className={severityBadgeClass(allergy.severity)}>
            {severityLabel(allergy.severity)}
          </Badge>
          {allergy.source === "patient" ? (
            <DeleteRowButton
              endpoints={[`/api/pulse/allergies?id=${allergy.id}`]}
              onDeleted={onChanged}
            />
          ) : null}
        </span>
      }
    >
      <span className="block truncate text-sm font-medium text-text-main">{allergy.label}</span>
      {allergy.reaction ? (
        <span className="text-xs text-text-secondary">{allergy.reaction}</span>
      ) : null}
    </StatementRow>
  );
}

// Delete affordance for self-entered rows only (the parent gates on
// source==='patient'/'manual'; the route re-enforces customer scope + source).
// `endpoints` is usually one URL; a vitals group captured at the same instant
// can be several, deleted together.
function DeleteRowButton({ endpoints, onDeleted }: { endpoints: string[]; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);

  const onClick = useCallback(async () => {
    if (deleting) return;
    if (typeof window !== "undefined" && !window.confirm("Remove this entry?")) return;
    setDeleting(true);
    try {
      const results = await Promise.all(
        endpoints.map((e) => pulseFetch(e, { method: "DELETE" })),
      );
      if (results.every((r) => r.ok)) {
        onDeleted();
        return;
      }
    } catch (err) {
      console.error("[pulse/records] delete failed", err);
    }
    setDeleting(false);
  }, [deleting, endpoints, onDeleted]);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deleting}
      aria-label="Remove"
      className="flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

function DocumentStatementRow({ doc }: { doc: DocumentRecord }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDownload = useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      const res = await pulseFetch<{ url?: string }>(`/api/pulse/documents/${doc.id}/signed-url`);
      if (!res.ok || !res.data.url) {
        setError("Couldn't open this file. Try again.");
        return;
      }
      window.open(res.data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("[pulse/records] document download failed", err);
      setError("Couldn't open this file. Try again.");
    } finally {
      setDownloading(false);
    }
  }, [doc.id]);

  return (
    <StatementRow
      day={formatStatementDay(doc.uploaded_at)}
      time={formatStatementTime(doc.uploaded_at)}
      trailing={
        <button
          type="button"
          onClick={onDownload}
          disabled={downloading}
          className="inline-flex items-center gap-1 rounded-lg bg-primary-50 px-2.5 py-1 text-xs font-bold text-primary hover:bg-blue-100 disabled:opacity-60"
        >
          <Download className="h-3.5 w-3.5" />
          {downloading ? "Opening…" : "Open"}
        </button>
      }
    >
      <span className="block truncate text-sm font-medium text-text-main">
        {doc.label || docTypeLabel(doc.doc_type)}
      </span>
      <span className="text-xs text-text-secondary">
        {[docTypeLabel(doc.doc_type), formatFileSize(doc.file_size_bytes)].filter(Boolean).join(" · ")}
      </span>
      {error ? <span className="block text-xs text-rose-600">{error}</span> : null}
    </StatementRow>
  );
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function Statement({ children }: { children: ReactNode }) {
  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {children}
    </ul>
  );
}

function SourceChip({ tag }: { tag: SourceTag | null }) {
  if (!tag) return null;
  const cls =
    tag.kind === "you"
      ? "bg-[#FEF1EC] text-[#C2410C]"
      : "bg-[#EAF2FF] text-[#2B81FF]";
  return (
    <span
      className={"whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide " + cls}
    >
      {tag.label}
    </span>
  );
}

function Badge({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span className={"inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold " + className}>
      {children}
    </span>
  );
}

function EmptyCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-sm text-text-secondary">
      {children}
    </div>
  );
}

function StatementSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0">
          <div className="h-6 w-12 rounded bg-slate-100" />
          <div className="h-4 flex-1 rounded bg-slate-50" />
          <div className="h-5 w-14 rounded-full bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-md">
      <p className="text-sm text-text-secondary">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-lg bg-primary-50 px-3 py-1.5 text-sm font-bold text-primary hover:bg-blue-100"
      >
        Try again
      </button>
    </div>
  );
}
