import { describe, it, expect } from "vitest";

import {
  computeCartQuote,
  BASE_VISIT_PAISE,
  BASE_EXTRA_UNIT_PAISE,
  BASE_VISIT_CODE,
  type ProcedureRow,
} from "../cartPricing";

// Catalog fixtures — real values from home_care_procedures_seed.csv.
const CATALOG: ProcedureRow[] = [
  { code: "im", name: "IM injection", tier: "base", is_base_included: true, absolute_price_paise: 19900, delta_paise: 0, price_type: "fixed", per_unit_addon_paise: null, hourly_addon_paise: null },
  { code: "sc", name: "SC injection", tier: "base", is_base_included: true, absolute_price_paise: 19900, delta_paise: 0, price_type: "fixed", per_unit_addon_paise: null, hourly_addon_paise: null },
  { code: "iv_injection", name: "IV Injection", tier: "standard", is_base_included: false, absolute_price_paise: 29900, delta_paise: 10000, price_type: "fixed", per_unit_addon_paise: null, hourly_addon_paise: null },
  { code: "suture", name: "Suture removal", tier: "advanced", is_base_included: false, absolute_price_paise: 39900, delta_paise: 20000, price_type: "per_unit_addon", per_unit_addon_paise: 10000, hourly_addon_paise: null },
  { code: "iv_drip", name: "IV Drip", tier: "standard", is_base_included: false, absolute_price_paise: 39900, delta_paise: 20000, price_type: "per_drip_hourly", per_unit_addon_paise: null, hourly_addon_paise: 15000 },
  { code: "dfu", name: "Diabetic foot ulcer dressing", tier: "expert", is_base_included: false, absolute_price_paise: 99900, delta_paise: 80000, price_type: "from", per_unit_addon_paise: null, hourly_addon_paise: null },
];

/** Every quote must reconcile: the line totals sum to total_paise. */
function assertReconciles(q: ReturnType<typeof computeCartQuote>) {
  const sum = q.line_items.reduce((a, l) => a + l.line_total_paise, 0);
  expect(sum).toBe(q.total_paise);
  expect(q.prepay_paise + q.at_visit_paise).toBe(q.total_paise);
}

describe("computeCartQuote", () => {
  it("returns all-zero for an empty cart (and for unknown codes)", () => {
    expect(computeCartQuote([], CATALOG)).toEqual({
      total_paise: 0,
      prepay_paise: 0,
      at_visit_paise: 0,
      line_items: [],
    });
    expect(computeCartQuote([{ code: "nope", qty: 3 }], CATALOG).total_paise).toBe(0);
  });

  it("charges the ₹199 base visit once for a single fixed add-on", () => {
    const q = computeCartQuote([{ code: "iv_injection", qty: 1 }], CATALOG);
    expect(q.prepay_paise).toBe(BASE_VISIT_PAISE + 10000); // 29900
    expect(q.total_paise).toBe(29900);
    expect(q.at_visit_paise).toBe(0);
    expect(q.line_items[0].code).toBe(BASE_VISIT_CODE);
    expect(q.line_items[0].line_total_paise).toBe(BASE_VISIT_PAISE);
    assertReconciles(q);
  });

  it("bills two base injections as 1 free + ₹100 (same code, qty 2)", () => {
    const q = computeCartQuote([{ code: "im", qty: 2 }], CATALOG);
    // base visit covers the first; the 2nd is one BASE_EXTRA_UNIT.
    expect(q.total_paise).toBe(BASE_VISIT_PAISE + BASE_EXTRA_UNIT_PAISE); // 29900
    const imLine = q.line_items.find((l) => l.code === "im")!;
    expect(imLine.line_total_paise).toBe(BASE_EXTRA_UNIT_PAISE);
    expect(imLine.meta?.first_free).toBe(true);
    assertReconciles(q);
  });

  it("bills two distinct base injections as 1 free + ₹100", () => {
    const q = computeCartQuote([{ code: "im", qty: 1 }, { code: "sc", qty: 1 }], CATALOG);
    expect(q.total_paise).toBe(BASE_VISIT_PAISE + BASE_EXTRA_UNIT_PAISE); // 29900
    assertReconciles(q);
  });

  it("handles a mixed base + non-base cart (base first unit free)", () => {
    const q = computeCartQuote(
      [{ code: "im", qty: 1 }, { code: "iv_injection", qty: 1 }],
      CATALOG,
    );
    // 19900 base + 0 (im free) + 10000 (iv) = 29900
    expect(q.total_paise).toBe(29900);
    expect(q.at_visit_paise).toBe(0);
    assertReconciles(q);
  });

  it("suture: prepays the delta, adds per-unit counts at visit", () => {
    const q = computeCartQuote([{ code: "suture", qty: 1, units: 3 }], CATALOG);
    expect(q.prepay_paise).toBe(BASE_VISIT_PAISE + 20000); // 39900 (visit + delta)
    expect(q.at_visit_paise).toBe(3 * 10000); // 30000 (3 sutures × ₹100)
    expect(q.total_paise).toBe(69900);
    const line = q.line_items.find((l) => l.code === "suture")!;
    expect(line.is_variable).toBe(true);
    assertReconciles(q);

    // No count at quote time → only the prepaid delta, flagged variable.
    const q0 = computeCartQuote([{ code: "suture", qty: 1 }], CATALOG);
    expect(q0.prepay_paise).toBe(39900);
    expect(q0.at_visit_paise).toBe(0);
    expect(q0.line_items.find((l) => l.code === "suture")!.is_variable).toBe(true);
  });

  it("drip: prepays ₹399/drip, bills extra hours after the 1st at visit", () => {
    const q = computeCartQuote([{ code: "iv_drip", qty: 1, hours: 3 }], CATALOG);
    expect(q.prepay_paise).toBe(BASE_VISIT_PAISE + 39900); // 59800 (visit + drip)
    expect(q.at_visit_paise).toBe(2 * 15000); // 30000 (hours 2 & 3)
    expect(q.total_paise).toBe(89800);
    assertReconciles(q);

    // 1 hour (or unspecified) → no hourly add-on.
    const q1 = computeCartQuote([{ code: "iv_drip", qty: 1, hours: 1 }], CATALOG);
    expect(q1.at_visit_paise).toBe(0);
    expect(q1.prepay_paise).toBe(59800);
  });

  it("from: prepays the starting/floor price, flagged variable", () => {
    const q = computeCartQuote([{ code: "dfu", qty: 1 }], CATALOG);
    expect(q.prepay_paise).toBe(BASE_VISIT_PAISE + 80000); // 99900
    expect(q.at_visit_paise).toBe(0);
    expect(q.total_paise).toBe(99900);
    expect(q.line_items.find((l) => l.code === "dfu")!.is_variable).toBe(true);
    assertReconciles(q);
  });

  it("reconciles a full mixed cart with variable + fixed + base rows", () => {
    const q = computeCartQuote(
      [
        { code: "im", qty: 2 },
        { code: "iv_injection", qty: 1 },
        { code: "suture", qty: 1, units: 2 },
        { code: "iv_drip", qty: 1, hours: 2 },
        { code: "dfu", qty: 1 },
      ],
      CATALOG,
    );
    // prepay: 19900 base + 10000 (im: 2nd unit) + 10000 (iv) + 20000 (suture delta)
    //         + 39900 (drip) + 80000 (dfu floor) = 179800
    expect(q.prepay_paise).toBe(179800);
    // at_visit: 2×10000 (suture) + 1×15000 (drip hour 2) = 35000
    expect(q.at_visit_paise).toBe(35000);
    expect(q.total_paise).toBe(214800);
    assertReconciles(q);
  });
});
