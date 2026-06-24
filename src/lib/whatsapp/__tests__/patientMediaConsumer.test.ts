// Patient photo & PDF — consumer orchestration + consented confirmation.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import {
  runPatientMediaTurn,
  confirmPendingSave,
  detectSaveIntent,
  type PendingDoc,
} from "@/lib/whatsapp/patientMediaConsumer";
import type { Identity } from "@/lib/whatsapp/identity";
import type { MediaClassification } from "@/lib/whatsapp/patientMedia";

const customer: Identity = { role: "customer", subRole: "registered", customerId: "cust-1" };
const newcomer: Identity = { role: "new" };

const rawImage = { type: "image", image: { id: "img-1", mime_type: "image/jpeg" } };
const rawPdf = { type: "document", document: { id: "pdf-1", mime_type: "application/pdf" } };

const okMedia = (mime: string) => async () => ({ ok: true as const, bytes: new Uint8Array([1]), mimeType: mime });
const cls = (over: Partial<MediaClassification>): MediaClassification => ({ category: "lab_report", visiblePersonName: null, visibleAge: null, ...over });
const owner = { fullName: "Sushma Sharma" };

describe("runPatientMediaTurn", () => {
  it("no media ref → not handled (falls through)", async () => {
    const out = await runPatientMediaTurn({ raw: { type: "text" }, identity: customer }, { fetchMedia: vi.fn(), classify: vi.fn() });
    expect(out.handled).toBe(false);
  });

  it("(j) non-PDF document / oversized → guarded refusal, NO vision call", async () => {
    const classify = vi.fn();
    const fetchMedia = vi.fn(async () => ({ ok: false as const, reason: "mime_not_allowed:application/msword" }));
    const out = await runPatientMediaTurn({ raw: rawPdf, identity: customer }, { fetchMedia, classify });
    expect(classify).not.toHaveBeenCalled(); // cost guard: no vision call
    expect(out.reply).toMatch(/only read PDFs or clear photos/i);
    expect(out.audits.some((a) => a.event === "patient_photo_rejected")).toBe(true);
  });

  it("(b) non-medical → refusal, NO pending (no store)", async () => {
    const out = await runPatientMediaTurn({ raw: rawImage, identity: customer }, {
      fetchMedia: okMedia("image/jpeg"), classify: vi.fn(async () => cls({ category: "non_medical" })),
    });
    expect(out.reply).toMatch(/doesn't look like a medical document/i);
    expect(out.pending).toBeUndefined();
  });

  it("unclear → asks for a clearer photo, no pending", async () => {
    const out = await runPatientMediaTurn({ raw: rawImage, identity: customer }, {
      fetchMedia: okMedia("image/jpeg"), classify: vi.fn(async () => cls({ category: "unclear" })),
    });
    expect(out.reply).toMatch(/clearer/i);
    expect(out.pending).toBeUndefined();
  });

  it("(h) new visitor → acknowledges, cannot file (no pending)", async () => {
    const out = await runPatientMediaTurn({ raw: rawImage, identity: newcomer }, {
      fetchMedia: okMedia("image/jpeg"), classify: vi.fn(async () => cls({ category: "prescription" })),
    });
    expect(out.reply).toMatch(/once your sanocare account is set up/i);
    expect(out.pending).toBeUndefined();
  });

  it("(c) identity anomaly → not stored, refusal + rejected audit", async () => {
    const out = await runPatientMediaTurn({ raw: rawImage, identity: customer }, {
      fetchMedia: okMedia("image/jpeg"),
      classify: vi.fn(async () => cls({ category: "lab_report", visiblePersonName: "Anjali Verma" })),
      loadOwner: async () => ({ owner, members: [] }),
    });
    expect(out.reply).toMatch(/belongs to someone who isn't on your account/i);
    expect(out.pending).toBeUndefined();
    expect(out.audits.some((a) => a.event === "patient_photo_rejected" && a.data.reason === "identity_anomaly")).toBe(true);
  });

  it("(a) genuine medical doc, owner match → asks to save + sets pending", async () => {
    const out = await runPatientMediaTurn({ raw: rawImage, identity: customer }, {
      fetchMedia: okMedia("image/jpeg"),
      classify: vi.fn(async () => cls({ category: "prescription", visiblePersonName: "Sushma" })),
      loadOwner: async () => ({ owner, members: [] }),
    });
    expect(out.reply).toMatch(/save it to your sanocare records/i);
    expect(out.pending).toMatchObject({ mediaId: "img-1", docType: "prescription", customerId: "cust-1" });
  });

  it("(i) PDF → classified via the document path, pending mime application/pdf", async () => {
    const classify = vi.fn(async () => cls({ category: "lab_report" }));
    const out = await runPatientMediaTurn({ raw: rawPdf, identity: customer }, {
      fetchMedia: okMedia("application/pdf"), classify, loadOwner: async () => ({ owner: { fullName: null }, members: [] }),
    });
    expect(classify).toHaveBeenCalledWith(expect.any(Uint8Array), "application/pdf");
    expect(out.pending).toMatchObject({ mimeType: "application/pdf", docType: "lab_report" });
  });
});

describe("detectSaveIntent", () => {
  it("yes / no / unclear", () => {
    expect(detectSaveIntent("yes please")).toBe("yes");
    expect(detectSaveIntent("haan save it")).toBe("yes");
    expect(detectSaveIntent("no thanks")).toBe("no");
    expect(detectSaveIntent("nahi")).toBe("no");
    expect(detectSaveIntent("what does it say?")).toBe("unclear");
  });
});

const pending: PendingDoc = { mediaId: "img-1", mimeType: "image/jpeg", category: "lab_report", docType: "lab_report", customerId: "cust-1" };

// The one canonical writer (#97 uploadToPulseVault) — mock shape for injection.
const okUpload = () => vi.fn(async (_a: { identity: Identity; media: { mediaId: string }; docType?: string; memberId?: string | null }) => ({ ok: true as const, message: "Saved your lab report to your Sanocare records 📄.", documentId: "doc-1" }));

describe("confirmPendingSave (consent → canonical uploadToPulseVault)", () => {
  it("(d) YES → files via uploadToPulseVault scoped by identity, one FILED audit", async () => {
    const upload = okUpload();
    const res = await confirmPendingSave({ pending, text: "yes save it", identity: customer }, { upload });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toMatchObject({ identity: customer, media: { mediaId: "img-1" }, docType: "lab_report", memberId: null });
    expect(res.reply).toMatch(/saved/i);
    expect(res.audits.some((a) => a.event === "patient_photo_filed")).toBe(true);
  });

  it("NO → does not store", async () => {
    const upload = vi.fn();
    const res = await confirmPendingSave({ pending, text: "no don't", identity: customer }, { upload });
    expect(upload).not.toHaveBeenCalled();
    expect(res.handled).toBe(true);
    expect(res.reply).toMatch(/won't save/i);
  });

  it("unclear → not handled (falls through to normal flow), nothing stored", async () => {
    const upload = vi.fn();
    const res = await confirmPendingSave({ pending, text: "what does my cholesterol mean?", identity: customer }, { upload });
    expect(res.handled).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });

  it("(e) member attribution only from explicit naming", async () => {
    const upload = okUpload();
    await confirmPendingSave(
      { pending, text: "yes, this is rohan's", identity: customer, members: [{ id: "m1", name: "Rohan Sharma" }] },
      { upload },
    );
    expect(upload.mock.calls[0][0].memberId).toBe("m1");
  });
});

describe("(f) never writes medications / vital_readings from media", () => {
  it("consumer + writer source reference no clinical-extraction tables", () => {
    const root = process.cwd();
    const consumer = readFileSync(path.resolve(root, "src/lib/whatsapp/patientMediaConsumer.ts"), "utf8");
    const writer = readFileSync(path.resolve(root, "src/lib/pulse/documentsWrite.ts"), "utf8");
    for (const src of [consumer, writer]) {
      expect(src).not.toMatch(/medications/);
      expect(src).not.toMatch(/vital_readings/);
    }
  });
});
