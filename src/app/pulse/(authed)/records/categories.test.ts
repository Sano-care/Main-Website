import { describe, it, expect } from "vitest";

import type { PulseRecords } from "@/lib/pulse/recordsFetch";
import {
  BANDS,
  CATEGORY_CONFIG,
  TIER_ICON,
  isRecordTileKey,
  sourceTag,
  tileSummary,
  type RecordTier,
  type RecordTileKey,
} from "./categories";

const ALL_KEYS = Object.keys(CATEGORY_CONFIG) as RecordTileKey[];
const ALL_TIERS: RecordTier[] = ["sanocare", "hybrid", "yours"];

function emptyRecords(over: Partial<PulseRecords> = {}): PulseRecords {
  return {
    customerId: "cust-1",
    scope: { memberId: null },
    bookings: [],
    prescriptions: [],
    vitals: [],
    medications: [],
    conditions: [],
    allergies: [],
    documents: [],
    accountLevelOmitted: [],
    ...over,
  };
}

describe("BANDS — the visual contract", () => {
  it("is three bands in the brief's order", () => {
    expect(BANDS.map((b) => b.tier)).toEqual(["sanocare", "hybrid", "yours"]);
  });

  it("covers every category exactly once", () => {
    const keys = BANDS.flatMap((b) => b.keys);
    expect(keys.slice().sort()).toEqual(ALL_KEYS.slice().sort());
    expect(new Set(keys).size).toBe(keys.length); // no dupes
  });

  it("places each category in its config tier's band", () => {
    for (const band of BANDS) {
      for (const key of band.keys) {
        expect(CATEGORY_CONFIG[key].tier).toBe(band.tier);
      }
    }
  });

  it("From Sanocare = read-only (no add control); Yours/hybrid have an action", () => {
    for (const key of ["bookings", "prescriptions", "reports", "invoices"] as const) {
      expect(CATEGORY_CONFIG[key].detailAction.type).toBe("none");
    }
    expect(CATEGORY_CONFIG.vitals.detailAction.type).toBe("link");
    expect(CATEGORY_CONFIG.medications.detailAction.type).toBe("link");
    expect(CATEGORY_CONFIG.documents.detailAction.type).toBe("modal");
    // Conditions/Allergies present-but-disabled this slice (R2 wires them).
    expect(CATEGORY_CONFIG.conditions.detailAction.type).toBe("soon");
    expect(CATEGORY_CONFIG.allergies.detailAction.type).toBe("soon");
  });

  it("marks Reports + Invoices as stubs (empty this slice)", () => {
    expect(CATEGORY_CONFIG.reports.stub).toBe(true);
    expect(CATEGORY_CONFIG.invoices.stub).toBe(true);
  });
});

describe("R1.1 — monoline icons", () => {
  it("every category has a lucide component icon (no emoji strings)", () => {
    for (const key of ALL_KEYS) {
      const icon = CATEGORY_CONFIG[key].icon;
      // lucide-react icons are forwardRef components → objects/functions, never strings.
      expect(typeof icon).not.toBe("string");
      expect(icon).toBeTruthy();
    }
  });

  it("TIER_ICON tints every tier (soft wrapper bg + accent stroke)", () => {
    for (const tier of ALL_TIERS) {
      expect(TIER_ICON[tier].wrapBg).toMatch(/^bg-/);
      expect(TIER_ICON[tier].stroke).toMatch(/^text-/);
    }
    // The brief's tier accents must be the stroke colours.
    expect(TIER_ICON.sanocare.stroke).toBe("text-[#2B81FF]");
    expect(TIER_ICON.hybrid.stroke).toBe("text-[#64748B]");
    expect(TIER_ICON.yours.stroke).toBe("text-[#F4845A]");
  });
});

describe("isRecordTileKey", () => {
  it("accepts the nine categories, rejects anything else", () => {
    for (const k of ALL_KEYS) expect(isRecordTileKey(k)).toBe(true);
    for (const bad of ["", "foo", "Bookings", "../etc", "constructor"]) {
      expect(isRecordTileKey(bad)).toBe(false);
    }
  });
});

describe("sourceTag — You vs Home visit (hybrid trust signal)", () => {
  it("manual → You (self-entered)", () => {
    expect(sourceTag("manual")).toEqual({ label: "You", kind: "you" });
  });
  it("device + rx_import → Home visit (clinician/Sanocare origin)", () => {
    expect(sourceTag("device")).toEqual({ label: "Home visit", kind: "sanocare" });
    expect(sourceTag("rx_import")).toEqual({ label: "Home visit", kind: "sanocare" });
  });
  it("null/undefined → no tag (never invented)", () => {
    expect(sourceTag(null)).toBeNull();
    expect(sourceTag(undefined)).toBeNull();
  });
});

describe("tileSummary", () => {
  it("counts when present, reuses empty copy when not", () => {
    const withData = emptyRecords({
      bookings: [{} as never, {} as never],
      documents: [{} as never],
    });
    expect(tileSummary("bookings", withData)).toEqual({ count: 2, label: "visits" });
    expect(tileSummary("documents", withData)).toEqual({ count: 1, label: "file" });
    expect(tileSummary("bookings", emptyRecords())).toEqual({ count: null, label: "No bookings yet" });
    expect(tileSummary("conditions", emptyRecords())).toEqual({ count: null, label: "None yet" });
  });

  it("Reports + Invoices are always empty stubs", () => {
    const full = emptyRecords({ bookings: [{} as never] });
    expect(tileSummary("reports", full)).toEqual({ count: null, label: "No reports yet" });
    expect(tileSummary("invoices", full)).toEqual({ count: null, label: "No invoices yet" });
  });

  it("hybrid categories show 'For your account' when omitted for a member view", () => {
    const omitted = emptyRecords({ accountLevelOmitted: ["vitals", "medications"] });
    expect(tileSummary("vitals", omitted)).toEqual({ count: null, label: "For your account" });
    expect(tileSummary("medications", omitted)).toEqual({ count: null, label: "For your account" });
  });
});
