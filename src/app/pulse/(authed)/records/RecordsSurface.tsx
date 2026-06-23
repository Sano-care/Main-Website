"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";

import { SectionReveal } from "@/components/marketing/SectionReveal";
import {
  useViewingMember,
  useViewingFirstName,
} from "@/app/pulse/_lib/MemberViewingContext";
import { pulseFetch } from "@/app/pulse/_lib/pulseClient";
import type {
  PulseRecords,
  BookingRecord,
  PrescriptionRecord,
  VitalRecord,
  MedicationRecord,
  ConditionRecord,
  AllergyRecord,
  DocumentRecord,
} from "@/lib/pulse/recordsFetch";
import {
  memberParamFor,
  serviceLabel,
  bookingStatusLabel,
  bookingStatusBadgeClass,
  docTypeLabel,
  formatFileSize,
  conditionStatusLabel,
  severityLabel,
  severityBadgeClass,
  sourceLabel,
  vitalLabel,
  vitalUnit,
  vitalValue,
  formatScheduleTimes,
  formatRecordDate,
} from "./recordsDisplay";

/**
 * Pulse "Your records" surface (Slice B). Display-only — it shows the data and
 * never interprets it clinically (no "high/low", no diagnosis); that's Aarogya's
 * explain_record with MoHFW guardrails in Slice C.
 *
 * Member scoping mirrors Slice A: the active viewing member drives `?member=`,
 * the server scopes by the session customer id, and account-level vitals/meds
 * are surfaced as such (via accountLevelOmitted) when a specific member is
 * selected — never reattributed to that member.
 */

const LOAD_ERROR = "Couldn't load your records. Check your connection and try again.";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; records: PulseRecords; loadedFor: string };

export default function RecordsSurface() {
  const { viewing, membersLoading } = useViewingMember();
  const viewingName = useViewingFirstName();
  const memberParam = memberParamFor(viewing);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Bumped by the retry button to force a re-fetch through the same effect.
  const [reloadKey, setReloadKey] = useState(0);

  // Fetch through an async function defined INSIDE the effect (the canonical
  // React data-loading shape): setState only ever runs in its post-await
  // continuation, never synchronously in the effect body. Initial "loading"
  // comes from useState; a member switch (memberParam) or retry (reloadKey)
  // re-runs it. The membersLoading gate ensures the viewing target — and so
  // memberParam — is final before the first fetch (no self→member double load).
  useEffect(() => {
    if (membersLoading) return;
    const ctrl = new AbortController();
    async function run() {
      const res = await pulseFetch<{ records?: PulseRecords }>(
        `/api/pulse/records?member=${encodeURIComponent(memberParam)}`,
        { signal: ctrl.signal },
      );
      if (ctrl.signal.aborted) return;
      if (!res.ok || !res.data.records) {
        setState({ status: "error", message: LOAD_ERROR });
        return;
      }
      setState({ status: "ready", records: res.data.records, loadedFor: memberParam });
    }
    void run();
    return () => ctrl.abort();
  }, [membersLoading, memberParam, reloadKey]);

  const heading = viewing.kind === "self" ? "Your records" : `${viewingName}'s records`;
  const initialLoading = membersLoading || state.status === "loading";
  // A member switch refetches while the previous result is still on screen.
  const stale = state.status === "ready" && state.loadedFor !== memberParam;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5">
      <header className="mb-4">
        <h1 className="text-xl font-bold text-text-main">{heading}</h1>
        <p className="mt-0.5 text-sm text-text-secondary">
          Everything Sanocare has on file, in one place.
        </p>
      </header>

      {initialLoading ? (
        <LoadingSkeleton />
      ) : state.status === "error" ? (
        <ErrorCard
          message={state.message}
          onRetry={() => {
            setState({ status: "loading" });
            setReloadKey((k) => k + 1);
          }}
        />
      ) : (
        <>
          {stale ? (
            <p className="mb-2 text-xs text-text-secondary" role="status">
              Updating…
            </p>
          ) : null}
          <RecordsBody records={state.records} viewingIsMember={viewing.kind === "member"} />
        </>
      )}
    </div>
  );
}

function RecordsBody({
  records,
  viewingIsMember,
}: {
  records: PulseRecords;
  viewingIsMember: boolean;
}) {
  const omitted = new Set(records.accountLevelOmitted);

  return (
    <div className="flex flex-col gap-3">
      <RecordSection title="Bookings" delay={0}>
        {records.bookings.length === 0 ? (
          <EmptyRow>No bookings yet.</EmptyRow>
        ) : (
          <Rows>
            {records.bookings.map((b) => (
              <BookingRow key={b.id} booking={b} />
            ))}
          </Rows>
        )}
      </RecordSection>

      <RecordSection title="Prescriptions" delay={40}>
        {records.prescriptions.length === 0 ? (
          <EmptyRow>No prescriptions yet.</EmptyRow>
        ) : (
          <Rows>
            {records.prescriptions.map((p) => (
              <PrescriptionRow key={p.id} rx={p} />
            ))}
          </Rows>
        )}
      </RecordSection>

      <RecordSection title="Vitals" delay={80}>
        {omitted.has("vitals") ? (
          <AccountLevelNote />
        ) : records.vitals.length === 0 ? (
          <EmptyRow>No vitals recorded yet.</EmptyRow>
        ) : (
          <Rows>
            {records.vitals.map((v) => (
              <VitalRow key={v.id} vital={v} />
            ))}
          </Rows>
        )}
      </RecordSection>

      <RecordSection title="Medications" delay={120}>
        {omitted.has("medications") ? (
          <AccountLevelNote />
        ) : records.medications.length === 0 ? (
          <EmptyRow>No medications on file.</EmptyRow>
        ) : (
          <Rows>
            {records.medications.map((m) => (
              <MedicationRow key={m.id} med={m} />
            ))}
          </Rows>
        )}
      </RecordSection>

      <RecordSection title="Conditions" delay={160}>
        {records.conditions.length === 0 ? (
          <EmptyRow>No conditions recorded.</EmptyRow>
        ) : (
          <Rows>
            {records.conditions.map((c) => (
              <ConditionRow key={c.id} condition={c} />
            ))}
          </Rows>
        )}
      </RecordSection>

      <RecordSection title="Allergies" delay={200}>
        {records.allergies.length === 0 ? (
          <EmptyRow>No allergies recorded.</EmptyRow>
        ) : (
          <Rows>
            {records.allergies.map((a) => (
              <AllergyRow key={a.id} allergy={a} />
            ))}
          </Rows>
        )}
      </RecordSection>

      <RecordSection title="Documents" delay={240}>
        {records.documents.length === 0 ? (
          <EmptyRow>
            No documents yet. Reports and prescriptions you share will appear here.
          </EmptyRow>
        ) : (
          <Rows>
            {records.documents.map((d) => (
              <DocumentRow key={d.id} doc={d} />
            ))}
          </Rows>
        )}
      </RecordSection>

      {viewingIsMember ? (
        <p className="px-1 pt-1 text-xs text-text-secondary">
          Viewing a family member. Vitals and medications are tracked for your
          whole account — switch back to yourself to see them.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function BookingRow({ booking }: { booking: BookingRecord }) {
  const when = booking.scheduled_for ?? booking.created_at;
  return (
    <RowShell
      title={serviceLabel(booking.service_category)}
      meta={formatRecordDate(when)}
      right={
        <Badge className={bookingStatusBadgeClass(booking.status)}>
          {bookingStatusLabel(booking.status)}
        </Badge>
      }
    />
  );
}

function PrescriptionRow({ rx }: { rx: PrescriptionRecord }) {
  const title = rx.doctor_name ? `Prescription from Dr ${rx.doctor_name}` : "Prescription";
  return (
    <RowShell
      title={title}
      meta={formatRecordDate(rx.sent_at)}
      right={
        rx.patient_view_token ? (
          <Link
            href={`/rx/${rx.patient_view_token}`}
            className="shrink-0 rounded-lg bg-primary-50 px-2.5 py-1 text-xs font-bold text-primary hover:bg-blue-100"
          >
            View →
          </Link>
        ) : null
      }
    />
  );
}

function VitalRow({ vital }: { vital: VitalRecord }) {
  const unit = vital.unit ?? vitalUnit(vital.kind);
  return (
    <RowShell
      title={vitalLabel(vital.kind)}
      meta={formatRecordDate(vital.taken_at)}
      right={
        <span className="shrink-0 text-right">
          <span className="font-mono text-sm font-semibold text-text-main">
            {vitalValue(vital)}
          </span>
          {unit ? <span className="ml-1 text-xs text-text-secondary">{unit}</span> : null}
        </span>
      }
    />
  );
}

function MedicationRow({ med }: { med: MedicationRecord }) {
  const schedule = formatScheduleTimes(med.scheduled_times);
  const sub = [med.dose, schedule].filter(Boolean).join(" · ");
  return (
    <RowShell
      title={med.name}
      meta={sub || med.reason || undefined}
      right={med.end_date ? null : <Badge className="bg-emerald-50 text-emerald-700">Active</Badge>}
    />
  );
}

function ConditionRow({ condition }: { condition: ConditionRecord }) {
  const metaBits = [formatRecordDate(condition.noted_at), sourceLabel(condition.source)].filter(
    (v): v is string => !!v && v !== "—",
  );
  return (
    <RowShell
      title={condition.label}
      meta={metaBits.length ? metaBits.join(" · ") : undefined}
      right={
        <Badge className="bg-slate-100 text-slate-600">
          {conditionStatusLabel(condition.status)}
        </Badge>
      }
    />
  );
}

function AllergyRow({ allergy }: { allergy: AllergyRecord }) {
  const sub = [allergy.reaction, sourceLabel(allergy.source)].filter(Boolean).join(" · ");
  return (
    <RowShell
      title={allergy.label}
      meta={sub || undefined}
      right={
        <Badge className={severityBadgeClass(allergy.severity)}>
          {severityLabel(allergy.severity)}
        </Badge>
      }
    />
  );
}

function DocumentRow({ doc }: { doc: DocumentRecord }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDownload = useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      const res = await pulseFetch<{ url?: string }>(
        `/api/pulse/documents/${doc.id}/signed-url`,
      );
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

  const sub = [docTypeLabel(doc.doc_type), formatFileSize(doc.file_size_bytes)]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-text-main">
          {doc.label || docTypeLabel(doc.doc_type)}
        </span>
        <span className="text-xs text-text-secondary">
          {sub} · {formatRecordDate(doc.uploaded_at)}
        </span>
        {error ? <span className="text-xs text-rose-600">{error}</span> : null}
      </span>
      <button
        type="button"
        onClick={onDownload}
        disabled={downloading}
        className="shrink-0 rounded-lg bg-primary-50 px-2.5 py-1 text-xs font-bold text-primary hover:bg-blue-100 disabled:opacity-60"
      >
        {downloading ? "Opening…" : "Download"}
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Shared presentational primitives (match the T90 home-tile vocabulary)
// ---------------------------------------------------------------------------

function RecordSection({
  title,
  delay,
  children,
}: {
  title: string;
  delay: number;
  children: ReactNode;
}) {
  return (
    <SectionReveal delay={delay}>
      <section className="rounded-2xl bg-white p-4 shadow-md">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-text-secondary">
          {title}
        </h2>
        {children}
      </section>
    </SectionReveal>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-slate-100">{children}</ul>;
}

function RowShell({
  title,
  meta,
  right,
}: {
  title: string;
  meta?: string;
  right?: ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-text-main">{title}</span>
        {meta ? <span className="text-xs text-text-secondary">{meta}</span> : null}
      </span>
      {right ? <span className="shrink-0">{right}</span> : null}
    </li>
  );
}

function Badge({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}
    >
      {children}
    </span>
  );
}

function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="py-1.5 text-sm text-text-secondary">{children}</p>;
}

function AccountLevelNote() {
  return (
    <p className="py-1.5 text-sm text-text-secondary">
      Tracked for your whole account. Switch to yourself to view.
    </p>
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

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-2xl bg-white p-4 shadow-md">
          <div className="mb-3 h-3 w-24 rounded bg-slate-100" />
          <div className="h-4 w-full rounded bg-slate-50" />
          <div className="mt-2 h-4 w-2/3 rounded bg-slate-50" />
        </div>
      ))}
    </div>
  );
}
