// Pulse vault upload (Slice C) — identity gate, customer_id-from-identity,
// mime/size validation, upload-rollback, and the DPDP audit.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/whatsapp/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  uploadToPulseVault,
  vaultDocumentBytes,
  type UploadToPulseVaultDeps,
  type VaultCoreDeps,
} from "./documentVault";
import type { Identity } from "@/lib/whatsapp/identity";
import type { InboundMedia } from "@/lib/whatsapp/media";

const CUSTOMER: Identity = {
  role: "customer",
  subRole: "registered",
  customerId: "cust-1",
  fullName: "Rajesh",
};
const NEW: Identity = { role: "new" };

const h = vi.hoisted(() => ({
  uploadCalls: [] as { bucket: string; path: string; size: number; contentType: string }[],
  removeCalls: [] as string[][],
  insertedRows: [] as Record<string, unknown>[],
  auditCalls: [] as Record<string, unknown>[],
}));

function makeSupabase(opts: { uploadError?: unknown; insertError?: unknown } = {}) {
  return {
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, bytes: Uint8Array, o: { contentType: string }) => {
          h.uploadCalls.push({ bucket, path, size: bytes.byteLength, contentType: o.contentType });
          return Promise.resolve({ error: opts.uploadError ?? null });
        },
        remove: (paths: string[]) => {
          h.removeCalls.push(paths);
          return Promise.resolve({ error: null });
        },
      }),
    },
    from: () => ({
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            if (opts.insertError) return Promise.resolve({ data: null, error: opts.insertError });
            h.insertedRows.push(row);
            return Promise.resolve({ data: { id: "doc-1" }, error: null });
          },
        }),
      }),
    }),
  };
}

function deps(over: Partial<UploadToPulseVaultDeps> = {}): UploadToPulseVaultDeps {
  return {
    fetchMedia: vi.fn(
      async (): Promise<InboundMedia> => ({
        ok: true,
        bytes: new Uint8Array([1, 2, 3, 4]),
        mimeType: "application/pdf",
      }),
    ),
    supabase: makeSupabase() as unknown as UploadToPulseVaultDeps["supabase"],
    writeAuditFn: vi.fn(async (e: Record<string, unknown>) => {
      h.auditCalls.push(e);
      return true;
    }) as unknown as UploadToPulseVaultDeps["writeAuditFn"],
    randomId: () => "fixed-uuid",
    ...over,
  };
}

beforeEach(() => {
  h.uploadCalls = [];
  h.removeCalls = [];
  h.insertedRows = [];
  h.auditCalls = [];
});

describe("uploadToPulseVault — identity gate", () => {
  it("non-customer → refused, nothing uploaded or audited", async () => {
    const res = await uploadToPulseVault(
      { identity: NEW, media: { mediaId: "m1", mime: "application/pdf" } },
      deps(),
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("not_customer");
    expect(h.uploadCalls).toHaveLength(0);
    expect(h.insertedRows).toHaveLength(0);
    expect(h.auditCalls).toHaveLength(0);
  });

  it("no media attached → asks for the file, no upload", async () => {
    const res = await uploadToPulseVault({ identity: CUSTOMER, media: null }, deps());
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("no_media");
    expect(h.uploadCalls).toHaveLength(0);
  });
});

describe("uploadToPulseVault — happy path", () => {
  it("uploads to pulse-documents, inserts a row scoped to identity.customerId, audits", async () => {
    const res = await uploadToPulseVault(
      {
        identity: CUSTOMER,
        media: { mediaId: "m1", mime: "application/pdf" },
        docType: "lab_report",
        label: "CBC June",
        memberId: "mem-9",
        conversationId: "conv-1",
      },
      deps(),
    );

    expect(res.ok).toBe(true);
    expect(res.documentId).toBe("doc-1");

    // stored in the private bucket at {customerId}/{docType}/{uuid}.pdf
    expect(h.uploadCalls).toHaveLength(1);
    expect(h.uploadCalls[0].bucket).toBe("pulse-documents");
    expect(h.uploadCalls[0].path).toBe("cust-1/lab_report/fixed-uuid.pdf");
    expect(h.uploadCalls[0].contentType).toBe("application/pdf");

    // metadata row — customer_id ALWAYS from identity, source tagged
    expect(h.insertedRows).toHaveLength(1);
    expect(h.insertedRows[0]).toMatchObject({
      customer_id: "cust-1",
      member_id: "mem-9",
      doc_type: "lab_report",
      file_path: "cust-1/lab_report/fixed-uuid.pdf",
      mime_type: "application/pdf",
      source: "whatsapp_aarogya",
      label: "CBC June",
    });
    expect(h.insertedRows[0].file_size_bytes).toBe(4);

    // audit — identity-aware, phone-free
    expect(h.auditCalls).toHaveLength(1);
    expect(h.auditCalls[0]).toMatchObject({
      eventType: "pulse_vault_uploaded",
      identity: { role: "customer:registered", identifiers: { customer_id: "cust-1" } },
    });
    expect(JSON.stringify(h.auditCalls[0])).not.toMatch(/\+?\d{10,}/);
  });

  it("unknown doc_type falls back to 'other'", async () => {
    await uploadToPulseVault(
      { identity: CUSTOMER, media: { mediaId: "m1", mime: "application/pdf" }, docType: "totally-made-up" },
      deps(),
    );
    expect(h.insertedRows[0].doc_type).toBe("other");
    expect(h.uploadCalls[0].path).toBe("cust-1/other/fixed-uuid.pdf");
  });
});

describe("uploadToPulseVault — validation + rollback", () => {
  it("media fetch failure → refused, no upload", async () => {
    const res = await uploadToPulseVault(
      { identity: CUSTOMER, media: { mediaId: "m1", mime: "application/pdf" } },
      deps({ fetchMedia: vi.fn(async (): Promise<InboundMedia> => ({ ok: false, reason: "too_large" })) }),
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("fetch_failed");
    expect(h.uploadCalls).toHaveLength(0);
  });

  it("disallowed mime → refused before upload", async () => {
    const res = await uploadToPulseVault(
      { identity: CUSTOMER, media: { mediaId: "m1", mime: "image/gif" } },
      deps({
        fetchMedia: vi.fn(async (): Promise<InboundMedia> => ({
          ok: true,
          bytes: new Uint8Array([1]),
          mimeType: "image/gif",
        })),
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("mime_not_allowed");
    expect(h.uploadCalls).toHaveLength(0);
  });

  it("metadata insert failure → rolls back the uploaded object, no audit", async () => {
    const res = await uploadToPulseVault(
      { identity: CUSTOMER, media: { mediaId: "m1", mime: "application/pdf" } },
      deps({ supabase: makeSupabase({ insertError: { message: "boom" } }) as unknown as UploadToPulseVaultDeps["supabase"] }),
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("insert_failed");
    expect(h.uploadCalls).toHaveLength(1);
    expect(h.removeCalls).toEqual([["cust-1/other/fixed-uuid.pdf"]]);
    expect(h.auditCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Shared core — the web (pulse_upload) entry point exercises this directly.
// ---------------------------------------------------------------------------

function coreDeps(over: Partial<VaultCoreDeps> = {}): VaultCoreDeps {
  return {
    supabase: makeSupabase() as unknown as VaultCoreDeps["supabase"],
    randomId: () => "fixed-uuid",
    ...over,
  };
}

const BYTES = new Uint8Array([1, 2, 3, 4]);

describe("vaultDocumentBytes — web upload (source='pulse_upload')", () => {
  it("uploads to the private bucket + inserts a customer-scoped row tagged pulse_upload", async () => {
    const res = await vaultDocumentBytes(
      {
        customerId: "cust-1",
        bytes: BYTES,
        mimeType: "application/pdf",
        docType: "lab_report",
        label: "CBC June",
        memberId: null,
        source: "pulse_upload",
      },
      coreDeps(),
    );

    expect(res.ok).toBe(true);
    expect(res.documentId).toBe("doc-1");
    expect(res.docType).toBe("lab_report");
    expect(res.sizeBytes).toBe(4);

    expect(h.uploadCalls).toEqual([
      { bucket: "pulse-documents", path: "cust-1/lab_report/fixed-uuid.pdf", size: 4, contentType: "application/pdf" },
    ]);
    expect(h.insertedRows[0]).toMatchObject({
      customer_id: "cust-1",
      member_id: null,
      doc_type: "lab_report",
      file_path: "cust-1/lab_report/fixed-uuid.pdf",
      mime_type: "application/pdf",
      source: "pulse_upload",
      label: "CBC June",
    });
    // The core itself never audits — the caller owns that.
    expect(h.auditCalls).toHaveLength(0);
  });

  it("accepts webp (allowed on web; .webp extension)", async () => {
    const res = await vaultDocumentBytes(
      { customerId: "cust-1", bytes: BYTES, mimeType: "image/webp", source: "pulse_upload" },
      coreDeps(),
    );
    expect(res.ok).toBe(true);
    expect(h.uploadCalls[0].path).toBe("cust-1/other/fixed-uuid.webp");
    expect(h.insertedRows[0].mime_type).toBe("image/webp");
  });

  it("rejects a disallowed mime before upload", async () => {
    const res = await vaultDocumentBytes(
      { customerId: "cust-1", bytes: BYTES, mimeType: "image/gif", source: "pulse_upload" },
      coreDeps(),
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("mime_not_allowed");
    expect(h.uploadCalls).toHaveLength(0);
    expect(h.insertedRows).toHaveLength(0);
  });

  it("rejects oversize before upload", async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    const res = await vaultDocumentBytes(
      { customerId: "cust-1", bytes: big, mimeType: "application/pdf", source: "pulse_upload" },
      coreDeps(),
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("too_large");
    expect(h.uploadCalls).toHaveLength(0);
  });

  it("rolls back the orphaned object on insert failure", async () => {
    const res = await vaultDocumentBytes(
      { customerId: "cust-1", bytes: BYTES, mimeType: "application/pdf", source: "pulse_upload" },
      coreDeps({ supabase: makeSupabase({ insertError: { message: "boom" } }) as unknown as VaultCoreDeps["supabase"] }),
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("insert_failed");
    expect(h.uploadCalls).toHaveLength(1);
    expect(h.removeCalls).toEqual([["cust-1/other/fixed-uuid.pdf"]]);
  });
});
