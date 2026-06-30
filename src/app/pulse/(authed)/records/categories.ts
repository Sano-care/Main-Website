// R1 Records redesign — the ownership model IS the visual system. Pure config +
// derivations (no JSX, no server-only runtime) so the bands, tiles, detail
// actions, summaries, and the hybrid source tag are all unit-testable and shared
// by the landing grid + the per-category detail screens.
//
// R1.1 — icons are monoline lucide-react components (same library + ~1.8 stroke
// as the homepage service sections), single-sourced here per category and tinted
// to the tier accent via TIER_ICON.
//
// Type-only import of the Slice A read contract — never pulls the server-only
// recordsFetch runtime into the client bundle (same discipline as recordsDisplay).

import {
  CalendarDays,
  ClipboardList,
  FlaskConical,
  Receipt,
  HeartPulse,
  Pill,
  Stethoscope,
  TriangleAlert,
  FileText,
  type LucideIcon,
} from "lucide-react";

import type { PulseRecords } from "@/lib/pulse/recordsFetch";

export type RecordTier = "sanocare" | "hybrid" | "yours";

export type RecordTileKey =
  | "bookings"
  | "prescriptions"
  | "reports"
  | "invoices"
  | "vitals"
  | "medications"
  | "conditions"
  | "allergies"
  | "documents";

/** What the detail screen offers as its primary action (the tile itself always
 *  just links into the detail screen — single interactive, a11y-clean). */
export type DetailAction =
  | { type: "none" }
  | { type: "link"; href: string; label: string } // existing add flow elsewhere
  | { type: "modal"; label: string }; // open an add/upload modal in place

export interface CategoryConfig {
  key: RecordTileKey;
  label: string;
  /** Monoline lucide icon (R1.1) — decorative; the text label carries meaning. */
  icon: LucideIcon;
  tier: RecordTier;
  /** Visual affordance shown on the tile foot (Open ›, + Log, + Add, + Upload). */
  tileAction: string;
  /** Real action surfaced on the detail screen. */
  detailAction: DetailAction;
  /** One-line subtitle on the detail "bank statement" screen. */
  detailSubtitle: string;
}

export const CATEGORY_CONFIG: Record<RecordTileKey, CategoryConfig> = {
  // From Sanocare — read-only, auto-added.
  bookings: {
    key: "bookings",
    label: "Bookings",
    icon: CalendarDays,
    tier: "sanocare",
    tileAction: "Open ›",
    detailAction: { type: "none" },
    detailSubtitle: "Every visit you've booked with Sanocare.",
  },
  prescriptions: {
    key: "prescriptions",
    label: "Prescriptions",
    icon: ClipboardList,
    tier: "sanocare",
    tileAction: "Open ›",
    detailAction: { type: "none" },
    detailSubtitle: "Prescriptions your Sanocare doctor has issued.",
  },
  reports: {
    key: "reports",
    label: "Reports",
    icon: FlaskConical,
    tier: "sanocare",
    tileAction: "Open ›",
    detailAction: { type: "none" },
    detailSubtitle: "Lab reports from your Sanocare tests.",
  },
  invoices: {
    key: "invoices",
    label: "Invoices",
    icon: Receipt,
    tier: "sanocare",
    tileAction: "Open ›",
    detailAction: { type: "none" },
    detailSubtitle: "Receipts for your Sanocare visits and tests.",
  },
  // Tracked together — you + home visits.
  vitals: {
    key: "vitals",
    label: "Vitals",
    icon: HeartPulse,
    tier: "hybrid",
    tileAction: "+ Log",
    detailAction: { type: "modal", label: "Log a reading" },
    detailSubtitle: "Logged by you, and auto-added from every Sanocare home visit.",
  },
  medications: {
    key: "medications",
    label: "Medications",
    icon: Pill,
    tier: "hybrid",
    tileAction: "+ Add",
    detailAction: { type: "modal", label: "Add a medication" },
    detailSubtitle: "What you take — added by you or from a Sanocare prescription.",
  },
  // Yours — patient-only.
  conditions: {
    key: "conditions",
    label: "Conditions",
    icon: Stethoscope,
    tier: "yours",
    tileAction: "+ Add",
    detailAction: { type: "modal", label: "Add a condition" },
    detailSubtitle: "Ongoing conditions you want Sanocare to know about.",
  },
  allergies: {
    key: "allergies",
    label: "Allergies",
    icon: TriangleAlert,
    tier: "yours",
    tileAction: "+ Add",
    detailAction: { type: "modal", label: "Add an allergy" },
    detailSubtitle: "Allergies your care team should always see.",
  },
  documents: {
    key: "documents",
    label: "Documents",
    icon: FileText,
    tier: "yours",
    tileAction: "+ Upload",
    detailAction: { type: "modal", label: "Upload a document" },
    detailSubtitle: "Reports, prescriptions, and scans you've added.",
  },
};

export interface TierBand {
  tier: RecordTier;
  label: string;
  /** Tailwind bg-* for the pin dot. */
  pinClass: string;
  keys: RecordTileKey[];
}

/** The three bands, in the brief's order. The visual contract. */
export const BANDS: TierBand[] = [
  {
    tier: "sanocare",
    label: "From Sanocare · read-only",
    pinClass: "bg-[#2B81FF]",
    keys: ["bookings", "prescriptions", "reports", "invoices"],
  },
  {
    tier: "hybrid",
    label: "Tracked together · you + home visits",
    pinClass: "bg-slate-400",
    keys: ["vitals", "medications"],
  },
  {
    tier: "yours",
    label: "Yours to manage",
    pinClass: "bg-[#F4845A]",
    keys: ["conditions", "allergies", "documents"],
  },
];

export function isRecordTileKey(slug: string): slug is RecordTileKey {
  return Object.prototype.hasOwnProperty.call(CATEGORY_CONFIG, slug);
}

/**
 * R1.1 — monoline tile-icon treatment per tier: a soft-tint wrapper + the icon
 * stroke in the tier accent (blue / slate / coral). Single-sourced so the
 * landing tiles and the detail-screen headers read identically. Stroke colours
 * are the tier accents the bands already use (BANDS pinClass).
 */
export const TIER_ICON: Record<RecordTier, { wrapBg: string; stroke: string }> = {
  sanocare: { wrapBg: "bg-[#EAF2FF]", stroke: "text-[#2B81FF]" },
  hybrid: { wrapBg: "bg-slate-100", stroke: "text-[#64748B]" },
  yours: { wrapBg: "bg-[#FEF1EC]", stroke: "text-[#F4845A]" },
};

// ---------------------------------------------------------------------------
// Hybrid source tag — "You" (self-entered) vs "Sanocare" (clinician-entered).
//
// vital_readings.source ∈ manual | device | rx_import   (DB CHECK)
// medications.source    ∈ manual | rx_import            (DB CHECK, nullable)
//   manual    → the patient logged it in Pulse                → "You"
//   device    → a GDA captured it on a Sanocare home visit    → "Sanocare"
//   rx_import → from a Sanocare prescription (teleconsult too) → "Sanocare"
// "Sanocare" (relabelled from "Home visit" in R2a) is more accurate than "Home
// visit" since rx_import also comes from teleconsults; the two-bucket split
// preserves the trust signal (clinician-entered vs self-entered). null → no tag.
// ---------------------------------------------------------------------------

export interface SourceTag {
  label: string;
  kind: "you" | "sanocare";
}

export function sourceTag(source: string | null | undefined): SourceTag | null {
  if (!source) return null;
  if (source === "manual") return { label: "You", kind: "you" };
  return { label: "Sanocare", kind: "sanocare" };
}

// ---------------------------------------------------------------------------
// Tile summary — count (mono) + label, reusing the existing empty copy.
// ---------------------------------------------------------------------------

export interface TileSummary {
  /** Number to render in IBM Plex Mono, or null for an empty/stub state. */
  count: number | null;
  /** Suffix when count != null, else the empty-state sentence. */
  label: string;
}

function omitted(records: PulseRecords, key: RecordTileKey): boolean {
  return (records.accountLevelOmitted as string[]).includes(key);
}

export function tileSummary(key: RecordTileKey, records: PulseRecords): TileSummary {
  switch (key) {
    case "bookings": {
      const n = records.bookings.length;
      return n > 0 ? { count: n, label: n === 1 ? "visit" : "visits" } : { count: null, label: "No bookings yet" };
    }
    case "prescriptions": {
      const n = records.prescriptions.length;
      return n > 0 ? { count: n, label: "on file" } : { count: null, label: "No prescriptions yet" };
    }
    case "reports": {
      const n = records.reports.length;
      return n > 0 ? { count: n, label: n === 1 ? "report" : "reports" } : { count: null, label: "No reports yet" };
    }
    case "invoices": {
      // Account-level (payments_v has no member_id) — omitted on a member view.
      if (omitted(records, "invoices")) return { count: null, label: "For your account" };
      const n = records.invoices.length;
      return n > 0 ? { count: n, label: n === 1 ? "receipt" : "receipts" } : { count: null, label: "No invoices yet" };
    }
    case "vitals": {
      if (omitted(records, "vitals")) return { count: null, label: "For your account" };
      const n = records.vitals.length;
      return n > 0 ? { count: n, label: n === 1 ? "reading" : "readings" } : { count: null, label: "No readings yet" };
    }
    case "medications": {
      if (omitted(records, "medications")) return { count: null, label: "For your account" };
      const n = records.medications.length;
      return n > 0 ? { count: n, label: "active" } : { count: null, label: "No medications yet" };
    }
    case "conditions": {
      const n = records.conditions.length;
      return n > 0 ? { count: n, label: n === 1 ? "recorded" : "recorded" } : { count: null, label: "None yet" };
    }
    case "allergies": {
      const n = records.allergies.length;
      return n > 0 ? { count: n, label: "recorded" } : { count: null, label: "None yet" };
    }
    case "documents": {
      const n = records.documents.length;
      return n > 0 ? { count: n, label: n === 1 ? "file" : "files" } : { count: null, label: "No documents yet" };
    }
  }
}
