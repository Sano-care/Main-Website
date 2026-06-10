import { describe, expect, it } from "vitest";
import {
  EMERGENCY_RESPONSE,
  detectEmergency,
} from "@/lib/whatsapp/safety/emergency-keywords";

describe("detectEmergency", () => {
  it("matches the DoD case: 'chest pain since 2 hours'", () => {
    const r = detectEmergency("chest pain since 2 hours");
    expect(r.matched).toBe(true);
    expect(r.keyword).toBe("chest pain");
  });

  it("is case-insensitive", () => {
    expect(detectEmergency("CHEST PAIN").matched).toBe(true);
  });

  it("matches Hinglish romanized keywords", () => {
    expect(detectEmergency("mujhe saans nahin aa rahi").matched).toBe(true);
    expect(detectEmergency("papa behosh ho gaye").matched).toBe(true);
  });

  it("matches phrases mid-sentence", () => {
    expect(detectEmergency("I think my dad had a heart attack").matched).toBe(true);
  });

  it("does not fire on unrelated words containing a keyword substring", () => {
    // 'fit' must not match inside 'benefit' / 'fitness' (word boundaries).
    expect(detectEmergency("what are the benefits of fitness").matched).toBe(false);
  });

  it("does not fire on benign messages", () => {
    expect(detectEmergency("hi, I want to book a lab test").matched).toBe(false);
    expect(detectEmergency("2").matched).toBe(false);
  });

  it("emergency response references 112 and 102", () => {
    expect(EMERGENCY_RESPONSE).toContain("112");
    expect(EMERGENCY_RESPONSE).toContain("102");
  });
});
