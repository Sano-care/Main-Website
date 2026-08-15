import { describe, it, expect } from "vitest";

import {
  LAUNCH_TARGET_ISO,
  LAUNCH_TARGET_MS,
  remainingSecondsAt,
  countdownParts,
  pad2,
} from "../countdown";

describe("launch target", () => {
  it("is 4:30 PM IST on 2026-08-15 (absolute epoch)", () => {
    expect(LAUNCH_TARGET_ISO).toBe("2026-08-15T16:30:00+05:30");
    // 16:30 IST == 11:00 UTC.
    expect(new Date(LAUNCH_TARGET_MS).toISOString()).toBe("2026-08-15T11:00:00.000Z");
  });
});

describe("remainingSecondsAt", () => {
  it("counts down before the target", () => {
    expect(remainingSecondsAt(1000_000, 1000_000 - 90_000)).toBe(90); // 90s before
  });
  it("is 0 exactly at and after the target (never negative)", () => {
    expect(remainingSecondsAt(1000_000, 1000_000)).toBe(0);
    expect(remainingSecondsAt(1000_000, 1000_000 + 5_000)).toBe(0);
  });
});

describe("countdownParts", () => {
  it("splits into Hrs:Min:Sec", () => {
    expect(countdownParts(3661)).toEqual({ hh: 1, mm: 1, ss: 1, launched: false });
    expect(countdownParts(7200)).toEqual({ hh: 2, mm: 0, ss: 0, launched: false });
    expect(countdownParts(59)).toEqual({ hh: 0, mm: 0, ss: 59, launched: false });
  });
  it("marks launched at zero", () => {
    expect(countdownParts(0)).toEqual({ hh: 0, mm: 0, ss: 0, launched: true });
    expect(countdownParts(-5).launched).toBe(true);
  });
});

describe("pad2", () => {
  it("zero-pads to 2 digits", () => {
    expect(pad2(7)).toBe("07");
    expect(pad2(42)).toBe("42");
    expect(pad2(0)).toBe("00");
  });
});
