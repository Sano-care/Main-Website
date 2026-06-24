// Shared lab catalogue search — the single ILIKE query used by both the website
// route and Aarogya's search_lab_tests tool.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { runLabTestSearch } from "@/lib/lab/search";

function fakeSupabase(cfg: { rows?: unknown[]; error?: { message: string } | null }) {
  const captured: { orArg?: string } = {};
  const api = {
    select: () => api,
    or: (arg: string) => {
      captured.orArg = arg;
      return api;
    },
    order: () => api,
    limit: async () => ({ data: cfg.rows ?? [], error: cfg.error ?? null }),
  };
  return { client: { from: () => api } as never, captured };
}

describe("runLabTestSearch", () => {
  it("returns [] for queries shorter than 2 chars (never scans the catalogue)", async () => {
    const { client } = fakeSupabase({});
    expect(await runLabTestSearch("a", { supabase: client })).toEqual([]);
    expect(await runLabTestSearch("", { supabase: client })).toEqual([]);
  });

  it("uses the 4-strategy ILIKE ranking (prefix-name/code, substring-name, category)", async () => {
    const { client, captured } = fakeSupabase({ rows: [{ code: "CBC", name: "Complete Blood Count" }] });
    const out = await runLabTestSearch("cbc", { supabase: client });
    expect(out).toHaveLength(1);
    expect(captured.orArg).toBe(
      "name.ilike.cbc%,code.ilike.cbc%,name.ilike.%cbc%,category.ilike.%cbc%",
    );
  });

  it("escapes ILIKE wildcards in user input", async () => {
    const { client, captured } = fakeSupabase({ rows: [] });
    await runLabTestSearch("a%b", { supabase: client });
    expect(captured.orArg).toContain("name.ilike.a\\%b%");
  });

  it("error → [] (never throws)", async () => {
    const { client } = fakeSupabase({ error: { message: "boom" } });
    expect(await runLabTestSearch("thyroid", { supabase: client })).toEqual([]);
  });
});
