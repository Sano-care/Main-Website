// Aarogya office-hours awareness hotfix — deterministic tests.
//
// The model-side behaviour (Aarogya not promising a 30-min SLA at 03:30) is
// governed by the prompt rule + the per-turn context line; these tests pin the
// mechanism that drives it: the open/closed clock, the rendered context line,
// and the presence of the rule in the system prompt.

import { describe, expect, it } from "vitest";
import { isSanocareOpen, OPEN_HOUR_IST, CLOSE_HOUR_IST } from "@/lib/agent/officeHours";
import { istHour } from "@/lib/time/formatIST";
import {
  renderContextBlock,
  buildAarogyaSystemPrompt,
  AAROGYA_SAFETY_RAILS,
  type ContextBlockInput,
} from "@/lib/agent/knowledge";

// IST = UTC+5:30. Inputs below are UTC instants chosen to land on a known IST time.
describe("isSanocareOpen — 09:00–21:00 IST, open=[09,21)", () => {
  it("03:30 IST → CLOSED (the bug hour)", () => {
    expect(isSanocareOpen(new Date("2026-06-22T22:00:00Z"))).toBe(false); // 03:30 IST
  });
  it("11:00 IST → OPEN", () => {
    expect(isSanocareOpen(new Date("2026-06-23T05:30:00Z"))).toBe(true); // 11:00 IST
  });
  it("09:00 IST → OPEN (lower boundary inclusive)", () => {
    expect(isSanocareOpen(new Date("2026-06-23T03:30:00Z"))).toBe(true); // 09:00 IST
  });
  it("08:59 IST → CLOSED", () => {
    expect(isSanocareOpen(new Date("2026-06-23T03:29:00Z"))).toBe(false); // 08:59 IST
  });
  it("20:59 IST → OPEN", () => {
    expect(isSanocareOpen(new Date("2026-06-23T15:29:00Z"))).toBe(true); // 20:59 IST
  });
  it("21:00 IST → CLOSED (upper boundary exclusive)", () => {
    expect(isSanocareOpen(new Date("2026-06-23T15:30:00Z"))).toBe(false); // 21:00 IST
  });
  it("constants are 9 and 21", () => {
    expect([OPEN_HOUR_IST, CLOSE_HOUR_IST]).toEqual([9, 21]);
  });
});

describe("istHour — IST hour-of-day", () => {
  it("maps the bug instant to 3 (03:xx IST)", () => {
    expect(istHour(new Date("2026-06-22T22:00:00Z"))).toBe(3);
  });
  it("midnight IST normalises to 0", () => {
    expect(istHour(new Date("2026-06-22T18:30:00Z"))).toBe(0); // 00:00 IST
  });
  it("null for unparseable", () => {
    expect(istHour("nope")).toBeNull();
  });
});

const baseCtx: ContextBlockInput = {
  patient_name: null,
  last_booking: null,
  carehub: null,
  language: null,
};

describe("renderContextBlock — office-hours line", () => {
  it("CLOSED → no-SLA-promise instruction + 9 AM expectation", () => {
    const out = renderContextBlock({ ...baseCtx, now_ist: "23 Jun 2026, 03:30 AM IST", is_open: false });
    expect(out).toContain("CLOSED");
    expect(out).toContain("9 AM–9 PM IST");
    expect(out).toMatch(/Do NOT promise a 30-minute medic/i);
    expect(out).toContain("03:30 AM IST");
  });
  it("OPEN → on-demand SLAs apply", () => {
    const out = renderContextBlock({ ...baseCtx, now_ist: "23 Jun 2026, 11:00 AM IST", is_open: true });
    expect(out).toContain("OPEN");
    expect(out).toMatch(/On-demand SLAs apply/i);
  });
  it("omitted (back-compat) → no office-hours line", () => {
    const out = renderContextBlock(baseCtx);
    expect(out).not.toContain("Sanocare is OPEN");
    expect(out).not.toContain("Sanocare is CLOSED");
  });
});

describe("system prompt carries the office-hours rule", () => {
  it("Safety Rail #10 exists with the closed-hours guidance + emergency exception", () => {
    expect(AAROGYA_SAFETY_RAILS).toMatch(/Office hours/i);
    expect(AAROGYA_SAFETY_RAILS).toMatch(/NEVER promise a 30-minute medic or 15-minute doctor/i);
    expect(AAROGYA_SAFETY_RAILS).toMatch(/Emergencies are the ONE exception/i);
  });
  it("the assembled system prompt includes it", () => {
    expect(buildAarogyaSystemPrompt()).toMatch(/9 AM–9 PM IST/);
  });
});
