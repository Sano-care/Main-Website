// Shared shapes for the Pulse surfaces. Kept in a plain (non server-only)
// module so client components can `import type` them without dragging the
// server-only data layer into the browser bundle.

import type { VitalKind } from "@/app/api/pulse/_lib/validation";

export type IntakeState = "pending" | "taken" | "skipped" | "missed";

/** One reading row as returned by GET /api/pulse/vitals. */
export interface VitalReading {
  id: string;
  kind: VitalKind;
  value_numeric: number;
  value_secondary: number | null;
  unit: string | null;
  taken_at: string;
  context_note: string | null;
  source: string;
  created_at: string;
}

/** One medication row as returned by GET /api/pulse/medications. */
export interface Medication {
  id: string;
  name: string;
  dose: string;
  frequency_label: string;
  times_per_day: number;
  scheduled_times: string[] | null;
  start_date: string | null;
  end_date: string | null;
  reason: string | null;
  source: string;
  source_rx_id: string | null;
  imported_needs_review: boolean;
  refill_warning_threshold_days: number | null;
  supply_qty: number | null;
  supply_updated_at: string | null;
  created_at: string;
}

/** One dose in a day's schedule (intake-log row joined to its medication). */
export interface ScheduledDose {
  intake_id: string;
  medication_id: string;
  name: string;
  dose: string;
  scheduled_at: string; // UTC ISO
  state: IntakeState;
  taken_at: string | null;
}

/** A recent, still-unimported Sanocare prescription the patient can import. */
export interface ImportableRx {
  id: string;
  doctor_name: string | null;
  sent_at: string | null;
  item_count: number;
}

/** A recent-activity entry on the Pulse home (a sent prescription). */
export interface RecentActivityItem {
  id: string;
  kind: "prescription";
  title: string;
  doctor_name: string | null;
  when: string | null;
  patient_view_token: string | null;
}

/** Per-medication adherence as returned by GET …/medications/adherence. */
export interface AdherencePerMed {
  medication_id: string;
  name: string;
  taken: number;
  skipped: number;
  missed: number;
  overdue_pending: number;
  due_total: number;
  rate: number | null;
}

export interface AdherenceResponse {
  window: string;
  overall: {
    taken: number;
    skipped: number;
    missed: number;
    overdue_pending: number;
    due_total: number;
    rate: number | null;
  };
  per_medication: AdherencePerMed[];
}
