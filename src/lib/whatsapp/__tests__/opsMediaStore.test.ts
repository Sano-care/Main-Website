// Ops media store — persist-on-receipt + retention purge.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import {
  persistInboundOpsMedia,
  purgeExpiredOpsMedia,
  OPS_MEDIA_BUCKET,
  DEFAULT_RETENTION_HOURS,
} from "@/lib/whatsapp/opsMediaStore";

type Row = { id: string; file_path: string };

function fakeSupabase(cfg: {
  uploadError?: { message: string } | null;
  insertError?: { message: string } | null;
  expiredRows?: Row[];
} = {}) {
  const calls = {
    uploads: [] as Array<{ bucket: string; path: string }>,
    inserts: [] as Record<string, unknown>[],
    removes: [] as Array<{ bucket: string; paths: string[] }>,
    softDeletes: [] as string[][],
    audits: [] as Array<{ event: string; data: Record<string, unknown> }>,
  };
  const storage = {
    from(bucket: string) {
      return {
        upload: async (path: string) => {
          calls.uploads.push({ bucket, path });
          return { error: cfg.uploadError ?? null };
        },
        remove: async (paths: string[]) => {
          calls.removes.push({ bucket, paths });
          return { error: null };
        },
      };
    },
  };
  const from = (table: string) => {
    const api = {
      insert: (row: Record<string, unknown>) => {
        calls.inserts.push(row);
        return { select: () => ({ single: async () => ({ data: cfg.insertError ? null : { id: "om-1" }, error: cfg.insertError ?? null }) }) };
      },
      select: () => api,
      lt: () => api,
      is: async () => ({ data: cfg.expiredRows ?? [], error: null }),
      update: () => ({ in: async (_c: string, ids: string[]) => { calls.softDeletes.push(ids); return { error: null }; } }),
    };
    void table;
    return api;
  };
  const writeAuditFn = vi.fn(async (e: { eventType: string; eventData?: Record<string, unknown> }) => {
    calls.audits.push({ event: e.eventType, data: e.eventData ?? {} });
    return true;
  });
  return { client: { storage, from } as never, writeAuditFn, calls };
}

const basePersist = {
  messageId: "msg-1",
  conversationId: "conv-1",
  senderRole: "customer",
  mediaKind: "image" as const,
  mediaId: "meta-1",
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: "image/jpeg",
  now: new Date("2026-06-24T00:00:00Z"),
  objectId: "obj-1",
};

describe("persistInboundOpsMedia", () => {
  it("(store) uploads to ops-media + inserts row + purge_after=+72h + OPS_MEDIA_STORED", async () => {
    const { client, writeAuditFn, calls } = fakeSupabase();
    const r = await persistInboundOpsMedia(basePersist, { supabase: client, writeAuditFn });
    expect(r.ok).toBe(true);
    expect(calls.uploads[0]).toEqual({ bucket: OPS_MEDIA_BUCKET, path: "conv-1/obj-1.jpg" });
    const row = calls.inserts[0];
    expect(row).toMatchObject({ conversation_id: "conv-1", sender_role: "customer", media_kind: "image", message_id: "msg-1", size_bytes: 3 });
    // +72h = +3 days from receipt.
    expect(row.purge_after).toBe(new Date("2026-06-27T00:00:00Z").toISOString());
    expect(DEFAULT_RETENTION_HOURS).toBe(72);
    expect(calls.audits.some((a) => a.event === "ops_media_stored")).toBe(true);
  });

  it("(medic) sender_role=medic, retention 72h", async () => {
    const { client, writeAuditFn, calls } = fakeSupabase();
    await persistInboundOpsMedia(
      { ...basePersist, senderRole: "medic", retentionHours: 72 },
      { supabase: client, writeAuditFn },
    );
    expect(calls.inserts[0]).toMatchObject({ sender_role: "medic" });
    expect(calls.inserts[0].purge_after).toBe(new Date("2026-06-27T00:00:00Z").toISOString());
  });

  it("upload failure → no insert", async () => {
    const { client, writeAuditFn, calls } = fakeSupabase({ uploadError: { message: "x" } });
    const r = await persistInboundOpsMedia(basePersist, { supabase: client, writeAuditFn });
    expect(r).toMatchObject({ ok: false, error: "upload_failed" });
    expect(calls.inserts).toHaveLength(0);
  });

  it("insert failure → rolls back the object", async () => {
    const { client, writeAuditFn, calls } = fakeSupabase({ insertError: { message: "x" } });
    const r = await persistInboundOpsMedia(basePersist, { supabase: client, writeAuditFn });
    expect(r).toMatchObject({ ok: false, error: "insert_failed" });
    expect(calls.removes).toEqual([{ bucket: OPS_MEDIA_BUCKET, paths: ["conv-1/obj-1.jpg"] }]);
  });
});

describe("purgeExpiredOpsMedia", () => {
  it("(purge) removes objects + soft-deletes expired rows, ONLY the ops-media bucket", async () => {
    const expired = [
      { id: "a", file_path: "conv-1/x.jpg" },
      { id: "b", file_path: "conv-2/y.pdf" },
    ];
    const { client, writeAuditFn, calls } = fakeSupabase({ expiredRows: expired });
    const out = await purgeExpiredOpsMedia(new Date("2026-06-30T00:00:00Z"), { supabase: client, writeAuditFn });
    expect(out).toEqual({ scanned: 2, purged: 2 });
    // Every remove targets ONLY ops-media — never pulse-documents / medic-documents.
    expect(calls.removes).toEqual([{ bucket: OPS_MEDIA_BUCKET, paths: ["conv-1/x.jpg", "conv-2/y.pdf"] }]);
    expect(calls.removes.every((r) => r.bucket === OPS_MEDIA_BUCKET)).toBe(true);
    expect(calls.softDeletes).toEqual([["a", "b"]]);
    expect(calls.audits.find((a) => a.event === "ops_media_purged")?.data).toEqual({ count: 2 });
  });

  it("nothing expired → no-op (2-day-old rows not returned by the < now filter)", async () => {
    const { client, writeAuditFn, calls } = fakeSupabase({ expiredRows: [] });
    const out = await purgeExpiredOpsMedia(new Date(), { supabase: client, writeAuditFn });
    expect(out).toEqual({ scanned: 0, purged: 0 });
    expect(calls.removes).toHaveLength(0);
    expect(calls.softDeletes).toHaveLength(0);
  });
});
