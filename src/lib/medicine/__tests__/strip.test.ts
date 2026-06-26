// Strip-photo vision — JSON parsing + the vision-call wrapper.

import { describe, expect, it, vi } from "vitest";

import { parseStripJson, readMedicineStrip } from "@/lib/medicine/strip";

describe("parseStripJson", () => {
  it("parses a clean strip read", () => {
    const out = parseStripJson(
      '{"ok": true, "brand": "Shelcal 500", "composition": "Calcium + Vit D3", "strength": "500mg"}',
    );
    expect(out).toEqual({
      ok: true,
      brand: "Shelcal 500",
      composition: "Calcium + Vit D3",
      strength: "500mg",
    });
  });

  it("extracts JSON even when wrapped in prose", () => {
    const out = parseStripJson('Sure!\n{"ok":true,"brand":"Pan-D","composition":"Pantoprazole + Domperidone","strength":null}\nDone');
    expect(out.ok).toBe(true);
    expect(out.brand).toBe("Pan-D");
    expect(out.strength).toBeNull();
  });

  it("ok=false in the payload → not ok", () => {
    expect(parseStripJson('{"ok": false, "brand": null, "composition": null, "strength": null}').ok).toBe(false);
  });

  it("ok=true but no brand → forced not ok (nothing to log)", () => {
    expect(parseStripJson('{"ok": true, "brand": null, "composition": "X", "strength": null}').ok).toBe(false);
  });

  it("non-JSON → not ok, no throw", () => {
    expect(parseStripJson("I can't read this image").ok).toBe(false);
  });
});

describe("readMedicineStrip", () => {
  const img = { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" };

  it("uses the injected vision fn (Sonnet) and returns the parsed strip", async () => {
    const visionFn = vi.fn(async () => ({
      text: '{"ok":true,"brand":"Becosules","composition":"B-complex + Vit C","strength":null}',
    }));
    const out = await readMedicineStrip(img, { visionFn: visionFn as never });
    expect(visionFn).toHaveBeenCalledTimes(1);
    expect(out.brand).toBe("Becosules");
    expect(out.ok).toBe(true);
  });

  it("vision throw → graceful not-ok, never propagates", async () => {
    const visionFn = vi.fn(async () => {
      throw new Error("vision down");
    });
    const out = await readMedicineStrip(img, { visionFn: visionFn as never });
    expect(out.ok).toBe(false);
  });
});
