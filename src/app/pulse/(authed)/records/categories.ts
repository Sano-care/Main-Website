// R1 Records redesign — the ownership model IS the visual system. Pure config +
// derivations (no JSX, no client/server runtime) so the bands, tiles, detail
// actions, summaries, and the hybrid source tag are all unit-testable and shared
// by the landing grid + the per-category detail screens.
//
// Type-only import of the Slice A read contract — never pulls the server-only
// recordsFetch runtime into the client bundle (same discipline as recordsDisplay).

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
  | { type: "modal"; label: string } // open the upload modal in place
  | { type: "soon"; label: string }; // present but disabled this slice (R2 wires it)

export interface CategoryConfig {
  key: RecordTileKey;
  label: string;
  icon: string; // emoji per the founder's mockup
  tier: RecordTier;
  /** Visual affordance shown on the tile foot (Open ›, + Log, + Add, + Upload). */
  tileAction: string;
  /** Real action surfaced on the detail screen. */
  detailAction: DetailAction;
  /** One-line subtitle on the detail "bank statement" screen. */
  detailSubtitle: string;
  /** Categories with no data layer this slice render an honest empty state only. */
  stub?: boolean;
}

export const CATEGORY_CONFIG: Record<RecordTileKey, CategoryConfig> = {
  // From Sanocare — read-only, auto-added.
  bookings: {
    key: "bookings",
    label: "Bookings",
    icon: "📅",
    tier: "sanocare",
    tileAction: "Open ›",
    detailAction: { type: "none" },
    detailSubtitle: "Every visit you've booked with Sanocare.",
  },
  prescriptions: {
    key: "prescriptions",
    label: "Prescriptions",
    icon: "℞",
    tier: "sanocare",
    tileAction: "Open ›",
    detailAction: { type: "none" },
    detailSubtitle: "Prescriptions your Sanocare doctor has issued.",
  },
  reports: {
    key: "reports",
    label: "Reports",
    icon: "🧪",
    tier: "sanocare",
    tileAction: "Open ›",
    detailAction: { type: "none" },
    detailSubtitle: "Lab reports from your Sanocare tests.",
    stub: true,
  },
  invoices: {
    key: "invoices",
    label: "Invoices",
    icon: "🧾",
    tier: "sanocare",
    tileAction: "Open ›",
    detailAction: { type: "none" },
    detailSubtitle: "Receipts for your Sanocare visits and tests.",
    stub: true,
  },
  // Tracked together — you + home visits.
  vitals: {
    key: "vitals",
    label: "Vitals",
    icon: "❤️",
    tier: "hybrid",
    tileAction: "+ Log",
    detailAction: { type: "link", href: "/pulse/vitals?add=bp", label: "Log a reading" },
    detailSubtitle: "Logged by you, and auto-added from every Sanocare home visit.",
  },
  medications: {
    key: "medications",
    label: "Medications",
    icon: "💊",
    tier: "hybrid",
    tileAction: "+ Add",
    detailAction: { type: "link", href: "/pulse/medications", label: "Add a medication" },
    detailSubtitle: "What you take — added by you or from a Sanocare prescription.",
  },
  // Yours — patient-only.
  conditions: {
    key: "conditions",
    label: "Conditions",
    icon: "🩺",
    tier: "yours",
    tileAction: "+ Add",
    detailAction: { type: "soon", label: "Add a condition" },
    detailSubtitle: "Ongoing conditions you want Sanocare to know about.",
  },
  allergies: {
    key: "allergies",
    label: "Allergies",
    icon: "⚠️",
    tier: "yours",
    tileAction: "+ Add",
    detailAction: { type: "soon", label: "Add an allergy" },
    detailSubtitle: "Allergies your care team should always see.",
  },
  documents: {
    key: "documents",
    label: "Documents",
    icon: "📄",
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

// ---------------------------------------------------------------------------
// Hybrid source tag — "You" (self-entered) vs "Home visit" (clinician/Sanocare).
//
// vital_readings.source ∈ manual | device | rx_import   (DB CHECK)
// medications.source    ∈ manual | rx_import            (DB CHECK, nullable)
//   manual    → the patient logged it in Pulse                → "You"
//   device    → a GDA captured it on a Sanocare home visit    → "Home visit"
//   rx_import → from a Sanocare prescription (clinician origin)→ "Home visit"
// The two-bucket split preserves the trust signal the mockup is after
// (clinician-entered vs self-entered). null → no tag (never invent one).
// ---------------------------------------------------------------------------

export interface SourceTag {
  label: string;
  kind: "you" | "sanocare";
}

export function sourceTag(source: string | null | undefined): SourceTag | null {
  if (!source) return null;
  if (source === "manual") return { label: "You", kind: "you" };
  return { label: "Home visit", kind: "sanocare" };
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
    case "reports":
      return { count: null, label: "No reports yet" };
    case "invoices":
      return { count: null, label: "No invoices yet" };
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
