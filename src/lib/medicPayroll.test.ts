import { describe, expect, it } from "vitest";

import {
  isLabServiceCategory,
  summarizeLedger,
  type LedgerEntryLike,
} from "./medicPayroll";

describe("summarizeLedger", () => {
  it("is all-zero for an empty ledger", () => {
    expect(summarizeLedger([])).toEqual({
      earnedPaise: 0,
      paidPaise: 0,
      balancePaise: 0,
    });
  });

  it("computes earned/paid/balance with payouts stored negative", () => {
    const entries: LedgerEntryLike[] = [
      { entry_type: "daily_wage", amount_paise: 120000 },
      { entry_type: "commission", amount_paise: 15000 },
      { entry_type: "payout", amount_paise: -100000 }, // paid 100000
    ];
    // earned 135000, paid 100000, balance 35000
    expect(summarizeLedger(entries)).toEqual({
      earnedPaise: 135000,
      paidPaise: 100000,
      balancePaise: 35000,
    });
  });

  it("nets reversals out of earned and balance", () => {
    const entries: LedgerEntryLike[] = [
      { entry_type: "daily_wage", amount_paise: 120000 },
      { entry_type: "reversal", amount_paise: -120000 },
    ];
    expect(summarizeLedger(entries)).toEqual({
      earnedPaise: 0,
      paidPaise: 0,
      balancePaise: 0,
    });
  });

  it("balance = earned - paid always holds", () => {
    const entries: LedgerEntryLike[] = [
      { entry_type: "revenue_share", amount_paise: 200000 },
      { entry_type: "overtime", amount_paise: 30000 },
      { entry_type: "payout", amount_paise: -50000 },
      { entry_type: "adjustment", amount_paise: -2000 },
    ];
    const s = summarizeLedger(entries);
    expect(s.balancePaise).toBe(s.earnedPaise - s.paidPaise);
  });
});

describe("isLabServiceCategory (C1 mirror)", () => {
  it("flags the lab lanes (case-insensitive)", () => {
    for (const c of ["lab", "lab-tests", "diagnostics", "LAB", "Lab-Tests"]) {
      expect(isLabServiceCategory(c)).toBe(true);
    }
  });

  it("does not flag clinical medic categories", () => {
    for (const c of ["home-visit", "homecare", "nursing", "medic-at-home", "chronic"]) {
      expect(isLabServiceCategory(c)).toBe(false);
    }
  });

  it("handles null / undefined / empty", () => {
    expect(isLabServiceCategory(null)).toBe(false);
    expect(isLabServiceCategory(undefined)).toBe(false);
    expect(isLabServiceCategory("")).toBe(false);
  });
});
