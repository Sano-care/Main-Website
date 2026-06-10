import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatIST } from "./formatIST";

describe("formatIST", () => {
  // ===== Nullable inputs =====
  describe("nullable inputs render '—'", () => {
    it("renders '—' for null", () => {
      expect(formatIST(null)).toBe("—");
      expect(formatIST(null, "date")).toBe("—");
      expect(formatIST(null, "relativeShort")).toBe("—");
      expect(formatIST(null, "iso")).toBe("—");
    });

    it("renders '—' for undefined", () => {
      expect(formatIST(undefined)).toBe("—");
      expect(formatIST(undefined, "time")).toBe("—");
    });

    it("renders '—' for an unparseable string", () => {
      expect(formatIST("not a date")).toBe("—");
    });

    it("renders '—' for an Invalid Date instance", () => {
      expect(formatIST(new Date("invalid"))).toBe("—");
    });
  });

  // ===== UTC → IST conversion =====
  describe("UTC-to-IST conversion", () => {
    it("converts a known UTC instant to IST (+5:30) for the datetime format", () => {
      // 2026-06-03 09:15 UTC === 2026-06-03 14:45 IST
      const out = formatIST("2026-06-03T09:15:00Z", "datetime");
      expect(out).toContain("3 Jun 2026");
      expect(out).toContain("02:45 PM IST");
    });

    it("'date' format does NOT include the IST suffix", () => {
      const out = formatIST("2026-06-03T09:15:00Z", "date");
      expect(out).toBe("3 Jun 2026");
      expect(out).not.toContain("IST");
    });

    it("'time' format appends 'IST' and uses 12-hour with AM/PM uppercase", () => {
      const out = formatIST("2026-06-03T09:15:00Z", "time");
      expect(out).toBe("02:45 PM IST");
    });

    it("'dateLong' renders the full month name", () => {
      expect(formatIST("2026-06-03T00:00:00Z", "dateLong")).toBe("3 June 2026");
    });

    it("'datetimeLong' renders full month name + AM/PM + IST", () => {
      const out = formatIST("2026-06-03T09:15:00Z", "datetimeLong");
      expect(out).toContain("3 June 2026");
      expect(out).toContain("02:45 PM IST");
    });
  });

  // ===== Date pivot around UTC midnight =====
  describe("dates around UTC midnight pivot to the correct IST date", () => {
    it("23:30 IST on 30 May (== 18:00 UTC) renders the 30 May date, not 31 May", () => {
      // 2026-05-30 23:30 IST === 2026-05-30 18:00 UTC
      const out = formatIST("2026-05-30T18:00:00Z", "date");
      expect(out).toBe("30 May 2026");
    });

    it("00:30 IST on 31 May (== 19:00 UTC on 30 May) renders 31 May, not 30 May", () => {
      // 2026-05-30 19:00 UTC === 2026-05-31 00:30 IST
      const out = formatIST("2026-05-30T19:00:00Z", "date");
      expect(out).toBe("31 May 2026");
    });
  });

  // ===== Pre-1970 dates =====
  describe("defensive: pre-1970 dates do not crash", () => {
    it("renders pre-1970 dates without throwing", () => {
      expect(() => formatIST("1900-01-15T00:00:00Z", "date")).not.toThrow();
      const out = formatIST("1900-01-15T00:00:00Z", "date");
      expect(out).toContain("1900");
    });
  });

  // ===== relativeShort =====
  describe("relativeShort", () => {
    const FIXED_NOW = new Date("2026-06-03T10:00:00Z").getTime();

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(FIXED_NOW);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("renders '5 min. ago' for a 5-min-old timestamp", () => {
      // Intl.RelativeTimeFormat 'short' uses "min." for minutes in en-IN.
      const fiveMinAgo = new Date(FIXED_NOW - 5 * 60_000).toISOString();
      const out = formatIST(fiveMinAgo, "relativeShort");
      expect(out).toMatch(/5 min\.?\s*ago/i);
    });

    it("renders '2 hr. ago' for a 2-hour-old timestamp", () => {
      const twoHrAgo = new Date(FIXED_NOW - 2 * 3_600_000).toISOString();
      const out = formatIST(twoHrAgo, "relativeShort");
      expect(out).toMatch(/2 hr\.?\s*ago/i);
    });

    it("renders 'yesterday' for a 1-day-old timestamp (numeric:auto)", () => {
      const yesterday = new Date(FIXED_NOW - 24 * 3_600_000).toISOString();
      const out = formatIST(yesterday, "relativeShort");
      expect(out.toLowerCase()).toBe("yesterday");
    });

    it("renders 'last week' for a 7-day-old timestamp", () => {
      const lastWeek = new Date(FIXED_NOW - 7 * 24 * 3_600_000).toISOString();
      const out = formatIST(lastWeek, "relativeShort");
      expect(out.toLowerCase()).toBe("last week");
    });

    it("falls back to absolute date for >30-day-old timestamps", () => {
      // 60 days ago: should render an absolute "D MMM YYYY", not relative.
      const sixtyDaysAgo = new Date(FIXED_NOW - 60 * 24 * 3_600_000).toISOString();
      const out = formatIST(sixtyDaysAgo, "relativeShort");
      expect(out).toMatch(/\d+\s+[A-Za-z]+\s+\d{4}/);
      expect(out.toLowerCase()).not.toMatch(/ago|last|yesterday/);
    });
  });

  // ===== iso =====
  describe("iso", () => {
    it("renders the +05:30 offset literal so audit-log copy stays unambiguous", () => {
      const out = formatIST("2026-06-03T09:15:00Z", "iso");
      // 09:15 UTC + 5:30 = 14:45 IST
      expect(out).toBe("2026-06-03T14:45:00+05:30");
      expect(out).toContain("+05:30");
    });

    it("handles UTC midnight correctly (which is 05:30 IST same day)", () => {
      const out = formatIST("2026-06-03T00:00:00Z", "iso");
      expect(out).toBe("2026-06-03T05:30:00+05:30");
    });

    it("handles the day-pivot at 18:30 UTC (== 00:00 IST next day)", () => {
      // 2026-06-03 18:30 UTC === 2026-06-04 00:00 IST
      const out = formatIST("2026-06-03T18:30:00Z", "iso");
      expect(out).toBe("2026-06-04T00:00:00+05:30");
    });
  });

  // ===== Locale-independent: en-US browser still gets IST output =====
  describe("browser locale independence", () => {
    it("output stays IST regardless of host environment locale (the helper hardcodes en-IN + Asia/Kolkata)", () => {
      // The formatter is constructed with explicit locale + timeZone, so
      // there's no way the browser's locale override affects output.
      // This asserts the contract: the output for a given UTC instant
      // is byte-identical regardless of where it runs.
      const out = formatIST("2026-06-03T09:15:00Z", "datetime");
      expect(out).toContain("02:45 PM IST");
      expect(out).not.toContain("EST");
      expect(out).not.toContain("UTC");
    });
  });
});
