// Media + vision foundation — vision primitive parsing + single-call contract.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/client", () => ({ generateVisionJson: vi.fn() }));

import { analyzeImage, parseVerdict } from "@/lib/agent/vision";

describe("parseVerdict", () => {
  it("parses clean JSON", () => {
    expect(parseVerdict('{"type":"medicine","confidence":0.9,"fields":{"document_type":null}}')).toEqual({
      type: "medicine",
      confidence: 0.9,
      fields: { document_type: null },
    });
  });
  it("extracts JSON wrapped in prose / fences", () => {
    const v = parseVerdict('Here you go:\n```json\n{"type":"REPORT","confidence":0.7}\n```');
    expect(v.type).toBe("report"); // lower-cased
    expect(v.confidence).toBe(0.7);
  });
  it("accepts `category` as an alias for type and collects leftover keys as fields", () => {
    const v = parseVerdict('{"category":"prescription","confidence":1,"document_type":"prescription"}');
    expect(v.type).toBe("prescription");
    expect(v.fields).toEqual({ document_type: "prescription" });
  });
  it("clamps confidence to [0,1]", () => {
    expect(parseVerdict('{"type":"x","confidence":5}').confidence).toBe(1);
    expect(parseVerdict('{"type":"x","confidence":-2}').confidence).toBe(0);
  });
  it("garbage / empty → safe other/0 verdict", () => {
    expect(parseVerdict("not json")).toEqual({ type: "other", confidence: 0, fields: {} });
    expect(parseVerdict("")).toEqual({ type: "other", confidence: 0, fields: {} });
  });
});

describe("analyzeImage — exactly one vision call", () => {
  it("calls the vision client once and returns the parsed verdict", async () => {
    const call = vi.fn(async (_req: { image: { mimeType: string }; userText: string }) => ({
      text: '{"type":"medicine","confidence":0.8,"fields":{}}',
    }));
    const out = await analyzeImage(
      { bytes: new Uint8Array([1]), mimeType: "image/jpeg", taskPrompt: "classify" },
      { call },
    );
    expect(call).toHaveBeenCalledTimes(1); // cost guard
    expect(call.mock.calls[0][0]).toMatchObject({
      image: { mimeType: "image/jpeg" },
      userText: "classify",
    });
    expect(out).toEqual({ type: "medicine", confidence: 0.8, fields: {} });
  });
});
