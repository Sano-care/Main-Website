// Media + vision foundation — Consumer 0: patient photo ack.

import { describe, expect, it, vi } from "vitest";
import {
  composePhotoAck,
  isPatientRole,
  runPatientPhotoConsumer,
} from "@/lib/whatsapp/photoConsumer";
import type { Identity } from "@/lib/whatsapp/identity";
import type { VisionResult } from "@/lib/agent/vision";

const v = (type: string, fields: Record<string, unknown> = {}): VisionResult => ({
  type,
  confidence: 0.9,
  fields,
});

describe("composePhotoAck — compliant, non-interpreting", () => {
  it("medicine → offers consult / Pulse log, never reads details", () => {
    const out = composePhotoAck(v("medicine"));
    expect(out).toMatch(/can't read medical details/i);
    expect(out).toMatch(/doctor consult|Pulse/i);
  });
  it("prescription/report → offers teleconsult, uses document_type label", () => {
    expect(composePhotoAck(v("prescription", { document_type: "prescription" }))).toMatch(/teleconsult/i);
    expect(composePhotoAck(v("report", { document_type: "lab report" }))).toContain("lab report");
  });
  it("other → redirect, no medical claim", () => {
    expect(composePhotoAck(v("other"))).toMatch(/send a prescription, report/i);
  });
});

describe("isPatientRole", () => {
  it("true for customer + new, false for staff", () => {
    expect(isPatientRole({ role: "customer", subRole: "registered", customerId: "c" } as Identity)).toBe(true);
    expect(isPatientRole({ role: "new" } as Identity)).toBe(true);
    expect(isPatientRole({ role: "medic", medicId: "m", fullName: "A" } as Identity)).toBe(false);
    expect(isPatientRole({ role: "doctor", doctorId: "d", fullName: "B" } as Identity)).toBe(false);
  });
});

const rawImage = { type: "image", image: { id: "i1", mime_type: "image/jpeg" } };

describe("runPatientPhotoConsumer", () => {
  it("happy path: one fetch + one analyze → medicine ack", async () => {
    const fetchMedia = vi.fn(async () => ({ ok: true as const, bytes: new Uint8Array([1]), mimeType: "image/jpeg" }));
    const analyze = vi.fn(async () => v("medicine"));
    const out = await runPatientPhotoConsumer({ raw: rawImage }, { fetchMedia, analyze });
    expect(fetchMedia).toHaveBeenCalledTimes(1);
    expect(analyze).toHaveBeenCalledTimes(1); // cost guard: one vision call
    expect(out.handled).toBe(true);
    expect(out.visionType).toBe("medicine");
    expect(out.reply).toMatch(/medicine/i);
  });

  it("no media ref → not handled (falls through)", async () => {
    const out = await runPatientPhotoConsumer({ raw: { type: "text" } }, { fetchMedia: vi.fn(), analyze: vi.fn() });
    expect(out.handled).toBe(false);
    expect(out.reply).toBeNull();
  });

  it("fetch failure → safe ack, no analyze call", async () => {
    const fetchMedia = vi.fn(async () => ({ ok: false as const, reason: "too_large" }));
    const analyze = vi.fn();
    const out = await runPatientPhotoConsumer({ raw: rawImage }, { fetchMedia, analyze });
    expect(analyze).not.toHaveBeenCalled();
    expect(out.handled).toBe(true);
    expect(out.reply).toMatch(/couldn't open it/i);
    expect(out.reason).toBe("too_large");
  });

  it("analyze throws → safe ack, never propagates", async () => {
    const fetchMedia = vi.fn(async () => ({ ok: true as const, bytes: new Uint8Array([1]), mimeType: "image/jpeg" }));
    const analyze = vi.fn(async () => {
      throw new Error("api down");
    });
    const out = await runPatientPhotoConsumer({ raw: rawImage }, { fetchMedia, analyze });
    expect(out.handled).toBe(true);
    expect(out.reason).toBe("analyze_failed");
    expect(out.reply).toMatch(/couldn't process it/i);
  });
});
