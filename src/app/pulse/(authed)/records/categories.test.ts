import { describe, it, expect } from "vitest";

import type { PulseRecords } from "@/lib/pulse/recordsFetch";
import {
  BANDS,
  CATEGORY_CONFIG,
  RECORD_TILE_ORDER,
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
    reports: [],
    invoices: [],
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

  it("R4 — RECORD_TILE_ORDER is the flat band order (single source for the home shortcuts)", () => {
    // The Pulse home "Your records" shortcuts map over exactly this list.
    expect(RECORD_TILE_ORDER).toEqual(BANDS.flatMap((b) => b.keys));
    expect(RECORD_TILE_ORDER.slice().sort()).toEqual(ALL_KEYS.slice().sort());
    // From-Sanocare tier leads (blue), Yours tier (coral) is last.
    expect(CATEGORY_CONFIG[RECORD_TILE_ORDER[0]].tier).toBe("sanocare");
    expect(CATEGORY_CONFIG[RECORD_TILE_ORDER[RECORD_TILE_ORDER.length - 1]].tier).toBe("yours");
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
    // R2b — Vitals/Medications now open in-place add modals (were "link" in R1).
    expect(CATEGORY_CONFIG.vitals.detailAction.type).toBe("modal");
    expect(CATEGORY_CONFIG.medications.detailAction.type).toBe("modal");
    expect(CATEGORY_CONFIG.documents.detailAction.type).toBe("modal");
    // R2a — Conditions/Allergies now open an add modal (were "soon" in R1).
    expect(CATEGORY_CONFIG.conditions.detailAction.type).toBe("modal");
    expect(CATEGORY_CONFIG.allergies.detailAction.type).toBe("modal");
  });

  it("R3 — Reports + Invoices are wired (read-only, no 'stub' flag left)", () => {
    // The stub concept is retired now that both pull real data.
    expect("stub" in CATEGORY_CONFIG.reports).toBe(false);
    expect("stub" in CATEGORY_CONFIG.invoices).toBe(false);
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

describe("sourceTag — You vs Sanocare (hybrid trust signal)", () => {
  it("manual → You (self-entered)", () => {
    expect(sourceTag("manual")).toEqual({ label: "You", kind: "you" });
  });
  it("device + rx_import → Sanocare (clinician-entered; relabelled from 'Home visit')", () => {
    expect(sourceTag("device")).toEqual({ label: "Sanocare", kind: "sanocare" });
    expect(sourceTag("rx_import")).toEqual({ label: "Sanocare", kind: "sanocare" });
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

  it("R3 — Reports + Invoices now reflect real counts", () => {
    const withData = emptyRecords({
      reports: [{} as never, {} as never],
      invoices: [{} as never],
    });
    expect(tileSummary("reports", withData)).toEqual({ count: 2, label: "reports" });
    expect(tileSummary("invoices", withData)).toEqual({ count: 1, label: "receipt" });
  });

  it("R3 — Reports + Invoices empty states; one report → singular", () => {
    const empty = emptyRecords({ bookings: [{} as never] });
    expect(tileSummary("reports", empty)).toEqual({ count: null, label: "No reports yet" });
    expect(tileSummary("invoices", empty)).toEqual({ count: null, label: "No invoices yet" });
    expect(tileSummary("reports", emptyRecords({ reports: [{} as never] }))).toEqual({ count: 1, label: "report" });
  });

  it("account-level categories show 'For your account' when omitted for a member view", () => {
    // R3 adds invoices alongside vitals/medications (payments_v has no member_id).
    const omitted = emptyRecords({ accountLevelOmitted: ["vitals", "medications", "invoices"] });
    expect(tileSummary("vitals", omitted)).toEqual({ count: null, label: "For your account" });
    expect(tileSummary("medications", omitted)).toEqual({ count: null, label: "For your account" });
    expect(tileSummary("invoices", omitted)).toEqual({ count: null, label: "For your account" });
  });
});
