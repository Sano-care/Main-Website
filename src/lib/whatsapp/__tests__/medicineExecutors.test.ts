// Medicine resolver executors — resolve / web / strip, with the clinical
// boundary and the catalogue self-growth.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import {
  executeResolveMedicine,
  executeLookupMedicineWeb,
  executeReadMedicineStrip,
} from "@/lib/whatsapp/medicineExecutors";
import type { Identity } from "@/lib/whatsapp/identity";
import type { MedicineCandidate } from "@/lib/medicine/resolve";

const registered: Identity = { role: "customer", subRole: "registered", customerId: "cus-1" };

type AnyMock = ReturnType<typeof vi.fn>;
const auditEvents = (m: AnyMock) =>
  m.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);

const cand = (over: Partial<MedicineCandidate>): MedicineCandidate => ({
  id: "m1",
  brand_name: "Shelcal 500",
  strength: "500mg",
  form: "Tablet",
  composition: "Calcium Carbonate + Vitamin D3",
  score: 0.9,
  ...over,
});

describe("executeResolveMedicine", () => {
  it("confident single → confirms the brand + audits MEDICINE_RESOLVED(confident)", async () => {
    const resolveFn = vi.fn(async () => [cand({})]);
    const writeAuditFn = vi.fn(async () => true);
    const out = await executeResolveMedicine({
      identity: registered,
      conversationId: "c1",
      input: { query: "shelcal" },
      deps: { resolveFn: resolveFn as never, writeAuditFn: writeAuditFn as never },
    });
    expect(out).toContain("Shelcal 500");
    expect(out).toMatch(/shall i set/i);
    expect(auditEvents(writeAuditFn)).toContain("medicine_resolved");
  });

  it("ambiguous → numbered options + offer the strip photo", async () => {
    const resolveFn = vi.fn(async () => [cand({ score: 0.45 }), cand({ id: "m2", brand_name: "Shelcal CT", score: 0.4 })]);
    const out = await executeResolveMedicine({
      identity: registered,
      conversationId: "c1",
      input: { query: "shel" },
      deps: { resolveFn: resolveFn as never, writeAuditFn: (vi.fn(async () => true)) as never },
    });
    expect(out).toMatch(/1\. /);
    expect(out).toMatch(/photo of the strip/i);
  });

  it("no catalogue match → asks for the strip photo, never stores a vague entry", async () => {
    const resolveFn = vi.fn(async () => []);
    const out = await executeResolveMedicine({
      identity: registered,
      conversationId: "c1",
      input: { query: "that white calcium tablet" },
      deps: { resolveFn: resolveFn as never, writeAuditFn: (vi.fn(async () => true)) as never },
    });
    expect(out).toMatch(/photo of the medicine strip/i);
  });
});

describe("executeLookupMedicineWeb", () => {
  it("disabled / no source → degrades to the strip photo (never guesses), no audit", async () => {
    const lookupFn = vi.fn(async () => ({ available: false }));
    const writeAuditFn = vi.fn(async () => true);
    const out = await executeLookupMedicineWeb({
      identity: registered,
      conversationId: "c1",
      input: { query: "obscuremed" },
      deps: { lookupFn: lookupFn as never, writeAuditFn: writeAuditFn as never },
    });
    expect(out).toMatch(/photo of the medicine strip/i);
    expect(writeAuditFn).not.toHaveBeenCalled();
  });

  it("source returns a candidate → proposes for confirmation + audits WEB_VERIFIED", async () => {
    const lookupFn = vi.fn(async () => ({
      available: true,
      proposed_brand: "Becosules",
      composition: "B-complex + Vit C",
      confidence: 0.7,
    }));
    const writeAuditFn = vi.fn(async () => true);
    const out = await executeLookupMedicineWeb({
      identity: registered,
      conversationId: "c1",
      input: { query: "becosule" },
      deps: { lookupFn: lookupFn as never, writeAuditFn: writeAuditFn as never },
    });
    expect(out).toContain("Becosules");
    expect(out).toMatch(/does your strip say/i);
    expect(auditEvents(writeAuditFn)).toContain("medicine_web_verified");
  });
});

describe("executeReadMedicineStrip", () => {
  const media = { mediaId: "wamid-img", mime: "image/jpeg" };
  const okFetch = vi.fn(async () => ({ ok: true, bytes: new Uint8Array([1]), mimeType: "image/jpeg" }));

  it("no image → asks for a strip photo", async () => {
    const out = await executeReadMedicineStrip({ identity: registered, conversationId: "c1", media: null });
    expect(out).toMatch(/photo of the medicine strip/i);
  });

  it("unreadable strip → asks for a clearer photo, audits PHOTO_READ(ok=false)", async () => {
    const readStripFn = vi.fn(async () => ({ ok: false, brand: null, composition: null, strength: null }));
    const writeAuditFn = vi.fn(async () => true);
    const out = await executeReadMedicineStrip({
      identity: registered,
      conversationId: "c1",
      media,
      deps: { fetchMediaFn: okFetch as never, readStripFn: readStripFn as never, writeAuditFn: writeAuditFn as never },
    });
    expect(out).toMatch(/clearer/i);
    expect(auditEvents(writeAuditFn)).toContain("medicine_photo_read");
  });

  it("strip read → catalogue match → confirms it", async () => {
    const readStripFn = vi.fn(async () => ({ ok: true, brand: "Shelcal", composition: "Calcium + D3", strength: "500mg" }));
    const resolveFn = vi.fn(async () => [cand({})]);
    const out = await executeReadMedicineStrip({
      identity: registered,
      conversationId: "c1",
      media,
      deps: { fetchMediaFn: okFetch as never, readStripFn: readStripFn as never, resolveFn: resolveFn as never, writeAuditFn: (vi.fn(async () => true)) as never },
    });
    expect(out).toContain("Shelcal 500");
  });

  it("strip read → NOT in catalogue → grows the catalogue (pending) + audits CATALOG_ADDED", async () => {
    const readStripFn = vi.fn(async () => ({ ok: true, brand: "Newmed XR", composition: "Some Salt 50mg", strength: "50mg" }));
    const resolveFn = vi.fn(async () => []); // no catalogue match
    const addPendingFn = vi.fn(async () => ({ added: true, id: "grown-1" }));
    const writeAuditFn = vi.fn(async () => true);
    const out = await executeReadMedicineStrip({
      identity: registered,
      conversationId: "c1",
      media,
      deps: {
        fetchMediaFn: okFetch as never,
        readStripFn: readStripFn as never,
        resolveFn: resolveFn as never,
        addPendingFn: addPendingFn as never,
        writeAuditFn: writeAuditFn as never,
      },
    });
    expect(addPendingFn).toHaveBeenCalledWith(
      expect.objectContaining({ brandName: "Newmed XR", source: "aarogya_strip", verifiedSource: "strip_photo", customerId: "cus-1" }),
    );
    expect(auditEvents(writeAuditFn)).toContain("medicine_catalog_added");
    expect(out).toContain("Newmed XR");
  });
});
