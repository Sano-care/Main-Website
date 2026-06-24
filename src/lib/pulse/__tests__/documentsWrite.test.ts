// Patient photo & PDF — vault writer (upload + insert + access log + rollback).

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { fileDocumentToVault } from "@/lib/pulse/documentsWrite";

function fakeSupabase(cfg: { uploadError?: { message: string } | null; insertError?: { message: string } | null }) {
  const calls = { uploads: [] as Array<{ bucket: string; path: string }>, inserts: [] as Record<string, unknown>[], removes: [] as string[][], accessLogs: 0 };
  const client = {
    storage: {
      from(bucket: string) {
        return {
          upload: async (path: string) => {
            calls.uploads.push({ bucket, path });
            return { error: cfg.uploadError ?? null };
          },
          remove: async (paths: string[]) => {
            calls.removes.push(paths);
            return { error: null };
          },
        };
      },
    },
    from(table: string) {
      if (table === "pulse_documents") {
        return {
          insert: (row: Record<string, unknown>) => {
            calls.inserts.push(row);
            return { select: () => ({ single: async () => ({ data: cfg.insertError ? null : { id: "doc-1" }, error: cfg.insertError ?? null }) }) };
          },
        };
      }
      // pulse_document_access_log
      return { insert: async () => { calls.accessLogs++; return { error: null }; } };
    },
  };
  return { client: client as never, calls };
}

const base = {
  customerId: "cust-1",
  memberId: null,
  docType: "lab_report",
  mimeType: "application/pdf",
  bytes: new Uint8Array([1, 2, 3]),
  objectId: "obj-1",
};

describe("fileDocumentToVault", () => {
  it("uploads under customer_id, inserts pulse_documents, writes access log", async () => {
    const { client, calls } = fakeSupabase({});
    const r = await fileDocumentToVault(base, { supabase: client });
    expect(r).toMatchObject({ ok: true, docId: "doc-1" });
    expect(calls.uploads[0]).toEqual({ bucket: "pulse-documents", path: "cust-1/obj-1.pdf" }); // scoped path
    expect(calls.inserts[0]).toMatchObject({
      customer_id: "cust-1",
      member_id: null,
      doc_type: "lab_report",
      mime_type: "application/pdf",
      file_size_bytes: 3,
      source: "aarogya",
    });
    expect(calls.accessLogs).toBe(1);
  });

  it("member_id passes through when set", async () => {
    const { client, calls } = fakeSupabase({});
    await fileDocumentToVault({ ...base, memberId: "mem-9" }, { supabase: client });
    expect(calls.inserts[0].member_id).toBe("mem-9");
  });

  it("upload failure → no insert", async () => {
    const { client, calls } = fakeSupabase({ uploadError: { message: "x" } });
    const r = await fileDocumentToVault(base, { supabase: client });
    expect(r).toMatchObject({ ok: false, error: "upload_failed" });
    expect(calls.inserts).toHaveLength(0);
  });

  it("insert failure → rolls back the uploaded object", async () => {
    const { client, calls } = fakeSupabase({ insertError: { message: "x" } });
    const r = await fileDocumentToVault(base, { supabase: client });
    expect(r).toMatchObject({ ok: false, error: "insert_failed" });
    expect(calls.removes).toEqual([["cust-1/obj-1.pdf"]]);
  });

  it("image mime → .jpg/.png extension", async () => {
    const { client, calls } = fakeSupabase({});
    await fileDocumentToVault({ ...base, mimeType: "image/png" }, { supabase: client });
    expect(calls.uploads[0].path).toBe("cust-1/obj-1.png");
  });
});
