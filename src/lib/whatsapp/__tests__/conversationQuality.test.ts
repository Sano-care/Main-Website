// Conversation-quality hotfix — pure helpers.

import { describe, expect, it } from "vitest";
import {
  locationFromRaw,
  synthesizeLocationText,
  coalesceInboundText,
  normalizeReply,
  isDuplicateReply,
  shouldAutoEscalateStalled,
  nextState,
  STALLED_TURN_CAP,
} from "@/lib/whatsapp/conversationQuality";

describe("locationFromRaw / synthesizeLocationText (C2)", () => {
  it("extracts coords + address and synthesises a structured note", () => {
    const loc = locationFromRaw({
      type: "location",
      location: { latitude: 28.54, longitude: 77.25, name: "Home", address: "GK-1, New Delhi" },
    });
    expect(loc).toEqual({ lat: 28.54, lng: 77.25, name: "Home", address: "GK-1, New Delhi" });
    expect(synthesizeLocationText(loc!)).toBe(
      "[Patient shared their location pin: 28.54,77.25 (GK-1, New Delhi)]",
    );
  });
  it("works with coords only", () => {
    const loc = locationFromRaw({ type: "location", location: { latitude: 1, longitude: 2 } });
    expect(synthesizeLocationText(loc!)).toBe("[Patient shared their location pin: 1,2]");
  });
  it("null when coords missing or wrong type", () => {
    expect(locationFromRaw({ type: "location", location: { name: "x" } })).toBeNull();
    expect(locationFromRaw({ type: "text" })).toBeNull();
  });
});

describe("coalesce + dedupe (C3)", () => {
  it("coalesces unanswered parts oldest→newest, dropping blanks", () => {
    expect(coalesceInboundText(["hi", "  ", "I need a nurse", null])).toBe("hi\nI need a nurse");
  });
  it("normalizeReply ignores case + punctuation", () => {
    expect(normalizeReply("Sure, I can help!")).toBe(normalizeReply("sure i can help"));
  });
  it("isDuplicateReply catches a near-identical recent reply", () => {
    expect(isDuplicateReply("Sure, I can help!", ["totally different", "Sure I can help."])).toBe(true);
    expect(isDuplicateReply("brand new reply", ["something else"])).toBe(false);
    expect(isDuplicateReply("", ["x"])).toBe(false);
  });
});

describe("shouldAutoEscalateStalled (C4)", () => {
  it(`fires once at the cap (${STALLED_TURN_CAP}) when not already escalated`, () => {
    expect(shouldAutoEscalateStalled({ turnCount: STALLED_TURN_CAP, escalationStatus: null, escalatedThisTurn: false })).toBe(true);
    expect(shouldAutoEscalateStalled({ turnCount: STALLED_TURN_CAP - 1, escalationStatus: null, escalatedThisTurn: false })).toBe(false);
  });
  it("never fires when the model already escalated this turn", () => {
    expect(shouldAutoEscalateStalled({ turnCount: 99, escalationStatus: null, escalatedThisTurn: true })).toBe(false);
  });
  it("rate-limited: never re-fires once an escalation exists (one per thread)", () => {
    expect(shouldAutoEscalateStalled({ turnCount: 99, escalationStatus: "requested", escalatedThisTurn: false })).toBe(false);
    expect(shouldAutoEscalateStalled({ turnCount: 99, escalationStatus: "complete", escalatedThisTurn: false })).toBe(false);
  });
});

describe("nextState (C5) — forward-only", () => {
  it("advances greeting → qualifying", () => {
    expect(nextState("greeting", "qualifying")).toBe("qualifying");
  });
  it("never regresses (escalated stays escalated)", () => {
    expect(nextState("escalated", "qualifying")).toBeNull();
    expect(nextState("qualified", "qualifying")).toBeNull();
  });
  it("unknown / terminal states never advance", () => {
    expect(nextState("opted_out", "qualifying")).toBeNull();
    expect(nextState("greeting", "bogus")).toBeNull();
  });
});
