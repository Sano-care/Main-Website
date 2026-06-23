import { describe, expect, it } from "vitest";

import {
  GDA_TASK_KEYS,
  isGdaTaskKey,
  isVitalTaskKey,
  parseVital,
  shiftKindAllowedForPattern,
} from "./shared";

describe("GDA_TASK_KEYS", () => {
  it("is the founder's 15-task list, unique", () => {
    expect(GDA_TASK_KEYS).toHaveLength(15);
    expect(new Set(GDA_TASK_KEYS).size).toBe(15);
  });

  it("contains the clinical tasks and no household chores", () => {
    for (const k of ["insulin", "nebulization", "bp", "medication", "diaper"]) {
      expect(GDA_TASK_KEYS).toContain(k);
    }
    for (const chore of ["cooking", "laundry", "dishes", "cleaning"]) {
      expect(GDA_TASK_KEYS).not.toContain(chore);
    }
  });
});

describe("isGdaTaskKey", () => {
  it("accepts known keys, rejects others", () => {
    expect(isGdaTaskKey("bp")).toBe(true);
    expect(isGdaTaskKey("medication")).toBe(true);
    expect(isGdaTaskKey("cooking")).toBe(false);
    expect(isGdaTaskKey(42)).toBe(false);
    expect(isGdaTaskKey(null)).toBe(false);
  });
});

describe("isVitalTaskKey", () => {
  it("only the four vital tasks mirror", () => {
    for (const k of ["bp", "pulse", "sugar", "temperature"]) {
      expect(isVitalTaskKey(k)).toBe(true);
    }
    for (const k of ["insulin", "diaper", "medication", "exercises"]) {
      expect(isVitalTaskKey(k)).toBe(false);
    }
  });
});

describe("shiftKindAllowedForPattern", () => {
  it("12h allows day12/night12 only", () => {
    expect(shiftKindAllowedForPattern("12h", "day12")).toBe(true);
    expect(shiftKindAllowedForPattern("12h", "night12")).toBe(true);
    expect(shiftKindAllowedForPattern("12h", "full24")).toBe(false);
  });
  it("24h allows full24 only", () => {
    expect(shiftKindAllowedForPattern("24h", "full24")).toBe(true);
    expect(shiftKindAllowedForPattern("24h", "day12")).toBe(false);
    expect(shiftKindAllowedForPattern("24h", "night12")).toBe(false);
  });
});

describe("parseVital", () => {
  it("parses BP into systolic/diastolic", () => {
    expect(parseVital("bp", "120/80")).toEqual({
      kind: "bp",
      value_numeric: 120,
      value_secondary: 80,
    });
    expect(parseVital("bp", "120 / 80")).toEqual({
      kind: "bp",
      value_numeric: 120,
      value_secondary: 80,
    });
    expect(parseVital("bp", "118-76")).toEqual({
      kind: "bp",
      value_numeric: 118,
      value_secondary: 76,
    });
  });

  it("rejects malformed BP", () => {
    expect(parseVital("bp", "120")).toBeNull();
    expect(parseVital("bp", "high")).toBeNull();
    expect(parseVital("bp", "")).toBeNull();
  });

  it("parses single-value vitals and tolerates a trailing unit", () => {
    expect(parseVital("pulse", "78")).toEqual({
      kind: "pulse_bpm",
      value_numeric: 78,
      value_secondary: null,
    });
    expect(parseVital("temperature", "98.6 F")).toEqual({
      kind: "temperature_c",
      value_numeric: 98.6,
      value_secondary: null,
    });
    expect(parseVital("sugar", "110 mg/dl")).toEqual({
      kind: "sugar_random",
      value_numeric: 110,
      value_secondary: null,
    });
  });

  it("returns null for non-vital tasks or unparseable text", () => {
    expect(parseVital("insulin", "10 units")).toBeNull(); // not a vital_readings kind
    expect(parseVital("pulse", "n/a")).toBeNull();
    expect(parseVital("sugar", "")).toBeNull();
    expect(parseVital("temperature", null)).toBeNull();
    expect(parseVital("temperature", undefined)).toBeNull();
  });
});
