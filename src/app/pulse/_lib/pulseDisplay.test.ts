import { describe, it, expect } from "vitest";

import {
  doseVisual,
  refillStatus,
  formatClock,
  formatAdherence,
  scheduleSummary,
  defaultTimesFor,
} from "./medsDisplay";
import {
  formatVitalValue,
  classifyVital,
} from "./vitalsDisplay";
import type { Medication, ScheduledDose } from "./pulseTypes";

function med(partial: Partial<Medication>): Medication {
  return {
    id: "m1",
    name: "Metformin",
    dose: "500mg",
    frequency_label: "Twice daily",
    times_per_day: 2,
    scheduled_times: ["08:00", "20:00"],
    start_date: "2026-06-01",
    end_date: null,
    reason: null,
    source: "manual",
    source_rx_id: null,
    imported_needs_review: false,
    refill_warning_threshold_days: 5,
    supply_qty: null,
    supply_updated_at: null,
    created_at: "2026-06-01T00:00:00Z",
    ...partial,
  };
}

function dose(partial: Partial<ScheduledDose>): ScheduledDose {
  return {
    intake_id: "i1",
    medication_id: "m1",
    name: "Metformin",
    dose: "500mg",
    scheduled_at: "2026-06-05T02:30:00Z", // 08:00 IST
    state: "pending",
    taken_at: null,
    ...partial,
  };
}

describe("refillStatus", () => {
  it("does not warn when supply is unknown", () => {
    expect(refillStatus(med({ supply_qty: null })).warn).toBe(false);
  });

  it("warns when remaining days <= threshold", () => {
    // 8 tablets / 2 per day = 4 days left, threshold 5 → warn.
    const r = refillStatus(med({ supply_qty: 8, times_per_day: 2 }));
    expect(r.warn).toBe(true);
    expect(r.daysLeft).toBe(4);
  });

  it("does not warn when comfortably stocked", () => {
    // 60 / 2 = 30 days, threshold 5 → no warn.
    expect(refillStatus(med({ supply_qty: 60, times_per_day: 2 })).warn).toBe(
      false,
    );
  });
});

describe("doseVisual", () => {
  const now = new Date("2026-06-05T12:00:00Z");

  it("renders taken doses as taken", () => {
    expect(doseVisual(dose({ state: "taken" }), now)).toBe("taken");
  });

  it("renders an overdue pending dose as missed", () => {
    // scheduled 02:30Z, now 12:00Z, still pending → missed.
    expect(doseVisual(dose({ state: "pending" }), now)).toBe("missed");
  });

  it("renders a future pending dose as upcoming", () => {
    expect(
      doseVisual(dose({ scheduled_at: "2026-06-05T20:00:00Z" }), now),
    ).toBe("upcoming");
  });
});

describe("formatClock", () => {
  it("converts 24h IST strings to 12h", () => {
    expect(formatClock("08:00")).toBe("8:00 AM");
    expect(formatClock("20:00")).toBe("8:00 PM");
    expect(formatClock("00:30")).toBe("12:30 AM");
    expect(formatClock("12:00")).toBe("12:00 PM");
  });
});

describe("formatAdherence", () => {
  it("formats the 92% (28/30) shape", () => {
    expect(formatAdherence(0.92, 28, 30)).toBe("92% (28/30)");
  });
  it("handles no due doses", () => {
    expect(formatAdherence(null, 0, 0)).toBe("No doses due yet");
  });
});

describe("scheduleSummary + defaultTimesFor", () => {
  it("summarises frequency + pretty times", () => {
    expect(scheduleSummary(med({}))).toBe("Twice daily · 8:00 AM, 8:00 PM");
  });
  it("maps dose counts to default IST times", () => {
    expect(defaultTimesFor(2)).toEqual(["08:00", "20:00"]);
    expect(defaultTimesFor(1)).toEqual(["09:00"]);
  });
});

describe("formatVitalValue", () => {
  it("renders BP as systolic/diastolic", () => {
    expect(
      formatVitalValue({ kind: "bp", value_numeric: 128, value_secondary: 82 }),
    ).toBe("128/82");
  });
  it("renders single-value kinds plainly", () => {
    expect(
      formatVitalValue({
        kind: "sugar_fasting",
        value_numeric: 110,
        value_secondary: null,
      }),
    ).toBe("110");
  });
});

describe("classifyVital", () => {
  it("flags elevated BP as warn and high BP as danger", () => {
    expect(
      classifyVital({ kind: "bp", value_numeric: 132, value_secondary: 82 }),
    ).toBe("warn");
    expect(
      classifyVital({ kind: "bp", value_numeric: 145, value_secondary: 95 }),
    ).toBe("danger");
  });
  it("treats a normal fasting sugar as good", () => {
    expect(
      classifyVital({
        kind: "sugar_fasting",
        value_numeric: 92,
        value_secondary: null,
      }),
    ).toBe("good");
  });
});
