// Pure presentation helpers for the Pulse "Your records" surface (Slice B).
//
// No JSX, no "use client", no "server-only" — shared by the records API route
// (server), the RecordsSurface client component, and the unit tests. Types are
// imported type-only from the Slice A read contract so this module never pulls
// the server-only recordsFetch runtime into the client bundle.
//
// Display-only: these helpers format and label record data. They do NOT
// interpret it clinically (no "high"/"low"/diagnosis) — that's Aarogya's
// explain_record with MoHFW guardrails in Slice C, never the Pulse UI.

import type { VitalKind } from "@/app/api/pulse/_lib/validation";
import { VITAL_META, formatVitalValue } from "@/app/pulse/_lib/vitalsDisplay";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MemberParam {
  /** undefined = all subjects · null = account holder · string = that member. */
  memberId: string | null | undefined;
}

/**
 * Map the `?member=` query value to a fetchPulseRecords subject filter.
 *  - missing / "" / "self" → account holder (memberId null)
 *  - "all"                 → every subject (memberId undefined)
 *  - a UUID                → that one family member
 *  - anything else         → { error } (the route 400s)
 *
 * Note: this only NARROWS within the authenticated customer's own rows — the
 * customer id always comes from the session, never from this value.
 */
export function parseMemberParam(raw: string | null): MemberParam | { error: string } {
  if (raw === null || raw === "" || raw === "self") return { memberId: null };
  if (raw === "all") return { memberId: undefined };
  if (UUID_RE.test(raw)) return { memberId: raw };
  return { error: "invalid_member" };
}

/** The `?member=` value the client sends for a given viewing target. */
export function memberParamFor(viewing: { kind: "self" } | { kind: "member"; member: { id: string } }): string {
  return viewing.kind === "self" ? "self" : viewing.member.id;
}

// ---------------------------------------------------------------------------
// Labels + formatting
// ---------------------------------------------------------------------------

function titleCaseFromSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const SERVICE_LABELS: Record<string, string> = {
  "home-visit": "Home Visit + Doctor Consult",
  "home-nursing": "Home Nursing",
  "lab-tests": "Lab Test at Home",
  "teleconsult": "Teleconsultation",
  "teleconsultation": "Teleconsultation",
};

export function serviceLabel(category: string | null): string {
  if (!category) return "Booking";
  return SERVICE_LABELS[category] ?? titleCaseFromSlug(category);
}

export function bookingStatusLabel(status: string): string {
  return titleCaseFromSlug(status.toLowerCase());
}

/** Neutral status tint — NOT a clinical judgement, just lifecycle colour. */
export function bookingStatusBadgeClass(status: string): string {
  const s = status.toUpperCase();
  if (s === "COMPLETED") return "bg-emerald-50 text-emerald-700";
  if (s === "CANCELLED") return "bg-rose-50 text-rose-700";
  if (s === "DISPATCHED" || s === "CONFIRMED") return "bg-blue-50 text-primary";
  return "bg-slate-100 text-slate-600";
}

// ---------------------------------------------------------------------------
// Invoices (receipts) — paise → ₹, and the paid/refunded status chip.
// ---------------------------------------------------------------------------

/**
 * Integer paise → an Indian-grouped rupee string for the receipt amount
 * (rendered in IBM Plex Mono). Whole amounts show no decimals; part-rupee
 * amounts show two. e.g. 49900 → "₹499", 120050 → "₹1,200.50". Invalid → "—".
 */
export function formatPaiseINR(paise: number): string {
  if (!Number.isFinite(paise)) return "—";
  const rupees = paise / 100;
  const hasPaise = Math.round(paise) % 100 !== 0;
  return (
    "₹" +
    rupees.toLocaleString("en-IN", {
      minimumFractionDigits: hasPaise ? 2 : 0,
      maximumFractionDigits: 2,
    })
  );
}

/** payments_v.status → a patient-facing receipt label. NOT_DUE never reaches the UI. */
export function invoiceStatusLabel(status: string): string {
  const s = status.toUpperCase();
  if (s === "CAPTURED") return "Paid";
  if (s === "REFUNDED") return "Refunded";
  return titleCaseFromSlug(status.toLowerCase());
}

/** Neutral status tint for a receipt — lifecycle colour, not a clinical signal. */
export function invoiceStatusBadgeClass(status: string): string {
  const s = status.toUpperCase();
  if (s === "CAPTURED") return "bg-emerald-50 text-emerald-700";
  if (s === "REFUNDED") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

const DOC_TYPE_LABELS: Record<string, string> = {
  lab_report: "Lab report",
  prescription: "Prescription",
  imaging: "Imaging",
  discharge_summary: "Discharge summary",
  other: "Document",
};

export function docTypeLabel(docType: string): string {
  return DOC_TYPE_LABELS[docType] ?? titleCaseFromSlug(docType);
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export function conditionStatusLabel(status: string): string {
  return titleCaseFromSlug(status.toLowerCase());
}

export function severityLabel(severity: string): string {
  return titleCaseFromSlug(severity.toLowerCase());
}

/** Neutral severity tint for allergies — a self-reported attribute, not triage. */
export function severityBadgeClass(severity: string): string {
  const s = severity.toLowerCase();
  if (s === "severe") return "bg-rose-50 text-rose-700";
  if (s === "moderate") return "bg-amber-50 text-amber-700";
  if (s === "mild") return "bg-slate-100 text-slate-600";
  return "bg-slate-100 text-slate-500";
}

/** Provenance chip ("Added by doctor" etc.) — shown small + muted. */
export function sourceLabel(source: string | null): string | null {
  if (!source) return null;
  switch (source) {
    case "patient":
      return "Self-entered";
    case "medic":
      return "Added by medic";
    case "doctor":
      return "Added by doctor";
    case "import":
      return "From a prescription";
    case "pulse_upload":
      return "Uploaded in Pulse";
    case "whatsapp_aarogya":
      return "Sent on WhatsApp";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Vitals + medications display (account-level)
// ---------------------------------------------------------------------------

export function vitalLabel(kind: string): string {
  return VITAL_META[kind as VitalKind]?.label ?? titleCaseFromSlug(kind);
}

export function vitalUnit(kind: string): string {
  return VITAL_META[kind as VitalKind]?.unit ?? "";
}

/** "128/82" for BP, "110" for sugar, etc. Reuses the home-tile formatter. */
export function vitalValue(reading: {
  kind: string;
  value_numeric: number | null;
  value_secondary: number | null;
}): string {
  return formatVitalValue({
    kind: reading.kind as VitalKind,
    value_numeric: reading.value_numeric ?? 0,
    value_secondary: reading.value_secondary,
  });
}

/** "8:00 AM, 8:00 PM" from stored 24h "HH:MM" slots; null/empty → "". */
export function formatScheduleTimes(times: string[] | null): string {
  if (!times || times.length === 0) return "";
  return times.map(formatClock12h).filter(Boolean).join(", ");
}

function formatClock12h(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return "";
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
}

// ---------------------------------------------------------------------------
// Dates — always rendered in IST (Asia/Kolkata), the patient's timezone.
// ---------------------------------------------------------------------------

const IST_DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** UTC ISO (or YYYY-MM-DD) → "12 Jun 2026" in IST. Invalid/null → "—". */
export function formatRecordDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return IST_DATE_FMT.format(d);
}

// Compact statement-row date/time (the "bank statement" detail screens). IST.
const IST_DAYMONTH_FMT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
});
const IST_TIME_FMT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "24 Jun" in IST. Invalid/null → "—". */
export function formatStatementDay(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return IST_DAYMONTH_FMT.format(d);
}

/** "09:10" (24h, IST), or "" when the timestamp has no meaningful time
 *  (a bare YYYY-MM-DD date) or is invalid/null. */
export function formatStatementTime(iso: string | null): string {
  if (!iso || /^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return IST_TIME_FMT.format(d);
}
