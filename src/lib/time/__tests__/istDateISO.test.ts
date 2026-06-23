// C3 C4 — istDateISO: the IST calendar date used for the presence_date /
// work_date key. The whole point is that the day boundary is IST (UTC+5:30),
// not UTC — a fixed-clock test pinning the midnight boundary is the guard the
// C3 exit criteria call for ("presence_date / work_date correct across an
// IST-midnight boundary").

import { describe, expect, it } from "vitest";
import { istDateISO } from "@/lib/time/formatIST";

describe("istDateISO — IST calendar date", () => {
  it("returns YYYY-MM-DD shape", () => {
    expect(istDateISO("2026-06-22T06:00:00Z")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("23:59:59 IST is still that IST day (UTC is already next day)", () => {
    // 18:29:59Z == 23:59:59 IST on the 21st.
    expect(istDateISO("2026-06-21T18:29:59Z")).toBe("2026-06-21");
  });

  it("00:00:00 IST rolls to the new IST day at the exact boundary", () => {
    // 18:30:00Z == 00:00:00 IST on the 22nd.
    expect(istDateISO("2026-06-21T18:30:00Z")).toBe("2026-06-22");
  });

  it("01:30 IST is still 'today' even though UTC is still yesterday", () => {
    // 20:00:00Z on the 21st == 01:30 IST on the 22nd.
    expect(istDateISO("2026-06-21T20:00:00Z")).toBe("2026-06-22");
  });

  it("midday is unambiguous", () => {
    expect(istDateISO("2026-06-22T06:00:00Z")).toBe("2026-06-22"); // 11:30 IST
  });

  it("year/month boundary holds in IST", () => {
    // 31 Dec 18:30:00Z == 1 Jan 00:00 IST.
    expect(istDateISO("2026-12-31T18:30:00Z")).toBe("2027-01-01");
    // 31 Dec 18:29:59Z == 31 Dec 23:59:59 IST.
    expect(istDateISO("2026-12-31T18:29:59Z")).toBe("2026-12-31");
  });

  it("accepts Date and epoch-ms inputs", () => {
    expect(istDateISO(new Date("2026-06-21T18:30:00Z"))).toBe("2026-06-22");
    expect(istDateISO(Date.parse("2026-06-21T18:29:59Z"))).toBe("2026-06-21");
  });

  it("returns null for nullish / unparseable input (caller fails closed)", () => {
    expect(istDateISO(null)).toBeNull();
    expect(istDateISO(undefined)).toBeNull();
    expect(istDateISO("not-a-date")).toBeNull();
  });
});
