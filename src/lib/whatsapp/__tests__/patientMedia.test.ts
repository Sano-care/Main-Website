// Patient photo & PDF — pure classification + identity-gate logic.

import { describe, expect, it } from "vitest";
import {
  normalizeClassification,
  namesMatch,
  assessOwnership,
  memberFromText,
  isFileableMedical,
  composeSaveAsk,
  docTypeLabel,
} from "@/lib/whatsapp/patientMedia";

describe("normalizeClassification", () => {
  it("keeps valid categories + extracts identity fields only", () => {
    const c = normalizeClassification("LAB_REPORT", { visible_person_name: "Sushma Sharma", visible_age: 68 });
    expect(c).toEqual({ category: "lab_report", visiblePersonName: "Sushma Sharma", visibleAge: 68 });
  });
  it("unknown type → unclear; bad fields → null", () => {
    expect(normalizeClassification("garbage", undefined)).toEqual({ category: "unclear", visiblePersonName: null, visibleAge: null });
    expect(normalizeClassification("prescription", { visible_person_name: "", visible_age: "x" }).visiblePersonName).toBeNull();
  });
});

describe("isFileableMedical", () => {
  it("medical categories fileable; non_medical/unclear not", () => {
    expect(["prescription", "lab_report", "medication_photo", "discharge_summary", "other_medical"].every(isFileableMedical as (s: string) => boolean)).toBe(true);
    expect(isFileableMedical("non_medical")).toBe(false);
    expect(isFileableMedical("unclear")).toBe(false);
  });
});

describe("namesMatch", () => {
  it("matches exact + partial first-name; rejects different", () => {
    expect(namesMatch("Sushma", "Sushma Sharma")).toBe(true);
    expect(namesMatch("Sushma Sharma", "Sushma")).toBe(true);
    expect(namesMatch("sushma sharma", "Sushma Sharma")).toBe(true);
    expect(namesMatch("Rajesh", "Sushma Sharma")).toBe(false);
    expect(namesMatch(null, "x")).toBe(false);
  });
});

describe("assessOwnership (identity/anomaly gate)", () => {
  const owner = { fullName: "Sushma Sharma" };
  const members = [{ id: "m1", name: "Rohan Sharma" }];
  it("no visible name → unchecked, not an anomaly (store as Self)", () => {
    expect(assessOwnership(null, owner, members)).toEqual({ anomaly: false, matched: "unchecked", memberId: null });
  });
  it("matches owner → Self", () => {
    expect(assessOwnership("Sushma", owner, members)).toMatchObject({ anomaly: false, matched: "owner" });
  });
  it("matches a family member name → on-account (not anomaly), memberId still null (D2)", () => {
    expect(assessOwnership("Rohan", owner, members)).toMatchObject({ anomaly: false, matched: "member", memberId: null });
  });
  it("matches nobody → ANOMALY (belongs to someone not on the account)", () => {
    expect(assessOwnership("Anjali Verma", owner, members)).toEqual({ anomaly: true, reason: "not_on_account" });
  });
});

describe("memberFromText — attribution from the patient's own words only", () => {
  const members = [{ id: "m1", name: "Rohan Sharma" }, { id: "m2", name: "Asha Devi" }];
  it("names a member → that member id", () => {
    expect(memberFromText("this is rohan's report", members)).toBe("m1");
    expect(memberFromText("save for asha", members)).toBe("m2");
  });
  it("no member named → null (Self)", () => {
    expect(memberFromText("yes save it", members)).toBeNull();
    expect(memberFromText(null, members)).toBeNull();
  });
});

describe("acks never interpret contents", () => {
  it("save-ask states the TYPE + that it can't read details", () => {
    const ask = composeSaveAsk("lab_report");
    expect(ask).toContain("lab report");
    expect(ask).toMatch(/can't read medical details/i);
    expect(ask).toMatch(/save it to your sanocare records/i);
  });
  it("docTypeLabel maps categories to friendly labels", () => {
    expect(docTypeLabel("medication_photo")).toBe("medicine");
    expect(docTypeLabel("discharge_summary")).toBe("discharge summary");
  });
});
