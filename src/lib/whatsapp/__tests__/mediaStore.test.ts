// Media + vision foundation — storage helper + retention ledger + purge.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { storeMedia, purgeExpiredMedia, signedUrl } from "@/lib/whatsapp/mediaStore";

type Row = { id: string; bucket: string; path: string };

function fakeSupabase(cfg: {
  uploadError?: { message: string } | null;
  insertError?: { message: string } | null;
  selectRows?: Row[];
  signed?: string;
}) {
  const calls = {
    uploads: [] as Array<{ bucket: string; path: string }>,
    removes: [] as Array<{ bucket: string; paths: string[] }>,
    inserts: 0,
    deletes: [] as string[][],
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
        createSignedUrl: async () => ({
          data: cfg.signed ? { signedUrl: cfg.signed } : null,
          error: cfg.signed ? null : { message: "no" },
        }),
      };
    },
  };
  const from = () => {
    const api = {
      insert: async () => {
        calls.inserts++;
        return { error: cfg.insertError ?? null };
      },
      select: () => api,
      lt: async () => ({ data: cfg.selectRows ?? [], error: null }),
      delete: () => ({
        in: async (_c: string, ids: string[]) => {
          calls.deletes.push(ids);
          return { error: null };
        },
      }),
    };
    return api;
  };
  return { client: { storage, from } as never, calls };
}

const baseArgs = {
  bucket: "patient-docs",
  path: "p/x.jpg",
  bytes: new Uint8Array([1]),
  mimeType: "image/jpeg",
  mediaId: "m1",
};

describe("storeMedia", () => {
  it("uploads then records the ledger row", async () => {
    const { client, calls } = fakeSupabase({});
    const out = await storeMedia(baseArgs, { supabase: client });
    expect(out.ok).toBe(true);
    expect(calls.uploads).toHaveLength(1);
    expect(calls.inserts).toBe(1);
  });

  it("upload failure → no ledger write", async () => {
    const { client, calls } = fakeSupabase({ uploadError: { message: "boom" } });
    const out = await storeMedia(baseArgs, { supabase: client });
    expect(out).toMatchObject({ ok: false, error: "upload_failed" });
    expect(calls.inserts).toBe(0);
  });

  it("ledger failure → rolls back the uploaded object", async () => {
    const { client, calls } = fakeSupabase({ insertError: { message: "boom" } });
    const out = await storeMedia(baseArgs, { supabase: client });
    expect(out).toMatchObject({ ok: false, error: "ledger_failed" });
    expect(calls.removes).toEqual([{ bucket: "patient-docs", paths: ["p/x.jpg"] }]);
  });
});

describe("purgeExpiredMedia", () => {
  it("removes storage objects (grouped by bucket) + deletes ledger rows", async () => {
    const rows: Row[] = [
      { id: "a", bucket: "b1", path: "x" },
      { id: "b", bucket: "b1", path: "y" },
      { id: "c", bucket: "b2", path: "z" },
    ];
    const { client, calls } = fakeSupabase({ selectRows: rows });
    const out = await purgeExpiredMedia(new Date("2026-06-23T00:00:00Z"), { supabase: client });
    expect(out).toEqual({ scanned: 3, removed: 3 });
    expect(calls.removes).toEqual([
      { bucket: "b1", paths: ["x", "y"] },
      { bucket: "b2", paths: ["z"] },
    ]);
    expect(calls.deletes).toEqual([["a", "b", "c"]]);
  });

  it("nothing expired → no-op", async () => {
    const { client, calls } = fakeSupabase({ selectRows: [] });
    const out = await purgeExpiredMedia(new Date(), { supabase: client });
    expect(out).toEqual({ scanned: 0, removed: 0 });
    expect(calls.removes).toHaveLength(0);
  });
});

describe("signedUrl", () => {
  it("returns the signed url", async () => {
    const { client } = fakeSupabase({ signed: "https://signed/x" });
    expect(await signedUrl("b", "p", 60, { supabase: client })).toBe("https://signed/x");
  });
  it("null on error", async () => {
    const { client } = fakeSupabase({});
    expect(await signedUrl("b", "p", 60, { supabase: client })).toBeNull();
  });
});
