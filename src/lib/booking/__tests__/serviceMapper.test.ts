// service_category T85 collapse — the write-boundary normalizer and the
// legacy→T85 read map. normalizeServiceCategory is the guarantee that no
// write path can emit a value the tightened CHECK (migration 20260725150000)
// rejects.

import { describe, expect, it } from "vitest";

import {
  dbToT85Slug,
  normalizeServiceCategory,
} from "@/lib/booking/serviceMapper";

const T85 = ["home-visit", "teleconsultation", "lab-tests", "medic-at-home"];

describe("normalizeServiceCategory — never emits a retired value", () => {
  it("maps every legacy value to its T85 slug (matches the migration)", () => {
    expect(normalizeServiceCategory("homecare")).toBe("home-visit");
    expect(normalizeServiceCategory("Home visit")).toBe("home-visit");
    expect(normalizeServiceCategory("teleconsult")).toBe("teleconsultation");
    expect(normalizeServiceCategory("diagnostics")).toBe("lab-tests");
    expect(normalizeServiceCategory("lab")).toBe("lab-tests");
    expect(normalizeServiceCategory("nursing")).toBe("medic-at-home");
  });

  it("passes the 4 canonical slugs through unchanged", () => {
    for (const slug of T85) expect(normalizeServiceCategory(slug)).toBe(slug);
  });

  it("coerces empty / null / unknown / retired 'chronic' to a valid slug", () => {
    for (const junk of ["", "  ", null, undefined, "chronic", "wat", "LAB"]) {
      expect(T85).toContain(normalizeServiceCategory(junk));
    }
  });

  it("ALWAYS returns one of the 4 T85 slugs (write can't trip the CHECK)", () => {
    const inputs = [
      "homecare", "teleconsult", "chronic", "nursing", "diagnostics", "lab",
      "Home visit", "home-visit", "teleconsultation", "lab-tests",
      "medic-at-home", "", "junk", null,
    ];
    for (const i of inputs) expect(T85).toContain(normalizeServiceCategory(i));
  });
});

describe("dbToT85Slug — renamed/legacy rows read correctly; no chronic", () => {
  it("maps legacy → T85 and passes T85 through", () => {
    expect(dbToT85Slug("homecare")).toBe("home-visit");
    expect(dbToT85Slug("teleconsult")).toBe("teleconsultation");
    expect(dbToT85Slug("diagnostics")).toBe("lab-tests");
    expect(dbToT85Slug("nursing")).toBe("medic-at-home");
    expect(dbToT85Slug("lab-tests")).toBe("lab-tests");
  });
  it("returns null for the retired 'chronic' token and unknowns (no chronic arm)", () => {
    expect(dbToT85Slug("chronic")).toBeNull();
    expect(dbToT85Slug("something-else")).toBeNull();
  });
});
