import { describe, it, expect } from "vitest";

import {
  parseMemberParam,
  memberParamFor,
  serviceLabel,
  bookingStatusLabel,
  bookingStatusBadgeClass,
  docTypeLabel,
  formatFileSize,
  severityLabel,
  severityBadgeClass,
  sourceLabel,
  vitalLabel,
  vitalUnit,
  vitalValue,
  formatScheduleTimes,
  formatRecordDate,
  formatPaiseINR,
  invoiceStatusLabel,
  invoiceStatusBadgeClass,
} from "./recordsDisplay";

describe("parseMemberParam", () => {
  it("missing / empty / 'self' → account holder (memberId null)", () => {
    expect(parseMemberParam(null)).toEqual({ memberId: null });
    expect(parseMemberParam("")).toEqual({ memberId: null });
    expect(parseMemberParam("self")).toEqual({ memberId: null });
  });
  it("'all' → every subject (memberId undefined)", () => {
    expect(parseMemberParam("all")).toEqual({ memberId: undefined });
  });
  it("a UUID → that member", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(parseMemberParam(id)).toEqual({ memberId: id });
  });
  it("garbage → error (route 400s; never trusted as an id)", () => {
    expect(parseMemberParam("../etc")).toEqual({ error: "invalid_member" });
    expect(parseMemberParam("not-a-uuid")).toEqual({ error: "invalid_member" });
  });
});

describe("memberParamFor", () => {
  it("self → 'self', member → its id", () => {
    expect(memberParamFor({ kind: "self" })).toBe("self");
    expect(memberParamFor({ kind: "member", member: { id: "abc" } })).toBe("abc");
  });
});

describe("labels", () => {
  it("serviceLabel maps known categories and title-cases unknowns/null", () => {
    expect(serviceLabel("lab-tests")).toBe("Lab Test at Home");
    expect(serviceLabel("home-nursing")).toBe("Home Nursing");
    expect(serviceLabel("some-new-service")).toBe("Some New Service");
    expect(serviceLabel(null)).toBe("Booking");
  });
  it("bookingStatusLabel + badge class", () => {
    expect(bookingStatusLabel("COMPLETED")).toBe("Completed");
    expect(bookingStatusLabel("PARTIAL_PAID")).toBe("Partial Paid");
    expect(bookingStatusBadgeClass("COMPLETED")).toContain("emerald");
    expect(bookingStatusBadgeClass("CANCELLED")).toContain("rose");
    expect(bookingStatusBadgeClass("PENDING")).toContain("slate");
  });
  it("docTypeLabel", () => {
    expect(docTypeLabel("lab_report")).toBe("Lab report");
    expect(docTypeLabel("discharge_summary")).toBe("Discharge summary");
    expect(docTypeLabel("other")).toBe("Document");
  });
  it("severity + source labels", () => {
    expect(severityLabel("severe")).toBe("Severe");
    expect(severityBadgeClass("severe")).toContain("rose");
    expect(severityBadgeClass("unknown")).toContain("slate");
    expect(sourceLabel("doctor")).toBe("Added by doctor");
    expect(sourceLabel("whatsapp_aarogya")).toBe("Sent on WhatsApp");
    expect(sourceLabel(null)).toBeNull();
  });
});

describe("formatFileSize", () => {
  it("formats B / KB / MB and guards bad input", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatFileSize(0)).toBe("—");
    expect(formatFileSize(-1)).toBe("—");
  });
});

describe("vitals display", () => {
  it("label + unit + value", () => {
    expect(vitalLabel("bp")).toBe("Blood pressure");
    expect(vitalUnit("sugar_fasting")).toBe("mg/dL");
    expect(vitalLabel("some_kind")).toBe("Some Kind");
    expect(vitalValue({ kind: "bp", value_numeric: 120, value_secondary: 80 })).toBe("120/80");
    expect(vitalValue({ kind: "sugar_fasting", value_numeric: 110, value_secondary: null })).toBe("110");
  });
});

describe("formatScheduleTimes", () => {
  it("converts 24h slots to 12h list; null/empty → ''", () => {
    expect(formatScheduleTimes(["08:00", "20:00"])).toBe("8:00 AM, 8:00 PM");
    expect(formatScheduleTimes(["00:30"])).toBe("12:30 AM");
    expect(formatScheduleTimes(null)).toBe("");
    expect(formatScheduleTimes([])).toBe("");
  });
});

describe("invoices (receipts)", () => {
  it("formatPaiseINR — paise → ₹, Indian grouping, decimals only when needed", () => {
    expect(formatPaiseINR(49900)).toBe("₹499");
    expect(formatPaiseINR(120050)).toBe("₹1,200.50");
    expect(formatPaiseINR(20000000)).toBe("₹2,00,000");
    expect(formatPaiseINR(0)).toBe("₹0");
    expect(formatPaiseINR(Number.NaN)).toBe("—");
  });
  it("invoiceStatusLabel — CAPTURED → Paid, REFUNDED → Refunded", () => {
    expect(invoiceStatusLabel("CAPTURED")).toBe("Paid");
    expect(invoiceStatusLabel("REFUNDED")).toBe("Refunded");
  });
  it("invoiceStatusBadgeClass — paid green, refunded amber", () => {
    expect(invoiceStatusBadgeClass("CAPTURED")).toContain("emerald");
    expect(invoiceStatusBadgeClass("REFUNDED")).toContain("amber");
    expect(invoiceStatusBadgeClass("OTHER")).toContain("slate");
  });
});

describe("formatRecordDate", () => {
  it("renders IST dates and guards null/invalid", () => {
    expect(formatRecordDate("2026-06-12T00:00:00Z")).toBe("12 Jun 2026");
    expect(formatRecordDate("2026-03-09")).toBe("9 Mar 2026");
    expect(formatRecordDate(null)).toBe("—");
    expect(formatRecordDate("not-a-date")).toBe("—");
  });
});
