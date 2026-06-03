import { describe, expect, it } from "vitest";
import {
  OPT_OUT_CONFIRMATION,
  detectOptOut,
} from "@/lib/whatsapp/safety/opt-out";

describe("detectOptOut", () => {
  it("matches the DoD case: 'STOP'", () => {
    const r = detectOptOut("STOP");
    expect(r.matched).toBe(true);
    expect(r.keyword).toBe("stop");
  });

  it("is case-insensitive and matches within a sentence", () => {
    expect(detectOptOut("please stop messaging me").matched).toBe(true);
    expect(detectOptOut("UNSUBSCRIBE").matched).toBe(true);
    expect(detectOptOut("remove me from this list").matched).toBe(true);
    expect(detectOptOut("do not contact me again").matched).toBe(true);
  });

  it("does not fire on words that merely contain a keyword", () => {
    // 'stop' must not match inside 'stopwatch'; 'remove' is whole-word only.
    expect(detectOptOut("I bought a stopwatch").matched).toBe(false);
    expect(detectOptOut("I need to go shopping").matched).toBe(false);
  });

  it("does not fire on benign messages", () => {
    expect(detectOptOut("can you help me book a nurse").matched).toBe(false);
  });

  it("confirmation is the exact required string", () => {
    expect(OPT_OUT_CONFIRMATION).toBe(
      "Got it. We won't message you again. If you change your mind, just message us. — Aarogya",
    );
  });
});
