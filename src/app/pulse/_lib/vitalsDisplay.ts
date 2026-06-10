// Presentation metadata for vital kinds — labels, units, value formatting and
// a light in-range classification. Pure data + functions (no JSX, no
// server-only) so both the SSR home tile and the client vitals surface share
// one vocabulary. Clinical thresholds here are deliberately coarse "glance"
// bands for colour hinting only — NOT diagnosis (Sanocare is planned care, not
// emergency triage); anything notable routes the patient to their doctor.

import type { VitalKind } from "@/app/api/pulse/_lib/validation";

export type VitalTrend = "good" | "warn" | "danger" | "neutral";

export interface VitalMeta {
  label: string;
  unit: string;
  /** True when the kind carries a second value (BP systolic/diastolic). */
  hasSecondary: boolean;
  /** Field labels for the add-reading form. */
  primaryLabel: string;
  secondaryLabel?: string;
  /** Sensible input step + placeholder. */
  step: number;
  placeholder: string;
  secondaryPlaceholder?: string;
}

export const VITAL_META: Record<VitalKind, VitalMeta> = {
  bp: {
    label: "Blood pressure",
    unit: "mmHg",
    hasSecondary: true,
    primaryLabel: "Systolic",
    secondaryLabel: "Diastolic",
    step: 1,
    placeholder: "128",
    secondaryPlaceholder: "82",
  },
  sugar_fasting: {
    label: "Sugar (fasting)",
    unit: "mg/dL",
    hasSecondary: false,
    primaryLabel: "Reading",
    step: 1,
    placeholder: "110",
  },
  sugar_postprandial: {
    label: "Sugar (post-meal)",
    unit: "mg/dL",
    hasSecondary: false,
    primaryLabel: "Reading",
    step: 1,
    placeholder: "140",
  },
  sugar_random: {
    label: "Sugar (random)",
    unit: "mg/dL",
    hasSecondary: false,
    primaryLabel: "Reading",
    step: 1,
    placeholder: "130",
  },
  weight_kg: {
    label: "Weight",
    unit: "kg",
    hasSecondary: false,
    primaryLabel: "Weight",
    step: 0.1,
    placeholder: "72.5",
  },
  temperature_c: {
    label: "Temperature",
    unit: "°C",
    hasSecondary: false,
    primaryLabel: "Temperature",
    step: 0.1,
    placeholder: "37.0",
  },
  spo2_pct: {
    label: "SpO₂",
    unit: "%",
    hasSecondary: false,
    primaryLabel: "Oxygen saturation",
    step: 1,
    placeholder: "98",
  },
  pulse_bpm: {
    label: "Pulse",
    unit: "bpm",
    hasSecondary: false,
    primaryLabel: "Pulse",
    step: 1,
    placeholder: "72",
  },
  other: {
    label: "Other",
    unit: "",
    hasSecondary: false,
    primaryLabel: "Value",
    step: 0.1,
    placeholder: "0",
  },
};

/** The kinds offered in the add-reading picker, in patient-priority order. */
export const VITAL_KIND_ORDER: VitalKind[] = [
  "bp",
  "sugar_fasting",
  "sugar_postprandial",
  "sugar_random",
  "weight_kg",
  "pulse_bpm",
  "spo2_pct",
  "temperature_c",
  "other",
];

/** Trim a number to at most one decimal, dropping a trailing ".0". */
function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/** The bare value, e.g. "128/82" for BP or "110" for sugar. */
export function formatVitalValue(reading: {
  kind: VitalKind;
  value_numeric: number;
  value_secondary: number | null;
}): string {
  if (reading.kind === "bp") {
    const sys = trimNum(reading.value_numeric);
    const dia =
      reading.value_secondary != null ? trimNum(reading.value_secondary) : "—";
    return `${sys}/${dia}`;
  }
  return trimNum(reading.value_numeric);
}

/** Coarse colour band for a reading — glance hinting only, not diagnosis. */
export function classifyVital(reading: {
  kind: VitalKind;
  value_numeric: number;
  value_secondary: number | null;
}): VitalTrend {
  const v = reading.value_numeric;
  const s = reading.value_secondary;
  switch (reading.kind) {
    case "bp": {
      const sys = v;
      const dia = s ?? 0;
      if (sys >= 140 || dia >= 90) return "danger";
      if (sys >= 130 || dia >= 85) return "warn";
      if (sys < 90 || dia < 60) return "warn";
      return "good";
    }
    case "sugar_fasting":
      if (v >= 126 || v < 70) return "danger";
      if (v >= 100) return "warn";
      return "good";
    case "sugar_postprandial":
    case "sugar_random":
      if (v >= 200 || v < 70) return "danger";
      if (v >= 140) return "warn";
      return "good";
    case "spo2_pct":
      if (v < 92) return "danger";
      if (v < 95) return "warn";
      return "good";
    case "temperature_c":
      if (v >= 38 || v < 35) return "danger";
      if (v >= 37.5) return "warn";
      return "good";
    case "pulse_bpm":
      if (v >= 120 || v < 50) return "warn";
      return "good";
    default:
      return "neutral";
  }
}

/** Map a trend band to a Tailwind text colour utility. */
export function trendTextClass(trend: VitalTrend): string {
  switch (trend) {
    case "good":
      return "text-emerald-600";
    case "warn":
      return "text-amber-600";
    case "danger":
      return "text-rose-600";
    default:
      return "text-slate-500";
  }
}
