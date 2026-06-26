// Catalogue resolver — RPC call shape, sanitisation, confidence bands.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import {
  resolveMedicineCatalog,
  classifyCandidates,
  type MedicineCandidate,
} from "@/lib/medicine/resolve";

function fakeSupabase(rows: unknown[] | null, error: { message: string } | null = null) {
  const calls: { fn?: string; params?: Record<string, unknown> } = {};
  return {
    client: {
      rpc: async (fn: string, params: Record<string, unknown>) => {
        calls.fn = fn;
        calls.params = params;
        return { data: rows, error };
      },
    } as never,
    calls,
  };
}

const cand = (over: Partial<MedicineCandidate>): MedicineCandidate => ({
  id: "m1",
  brand_name: "Shelcal 500",
  strength: "500mg",
  form: "Tablet",
  composition: "Calcium Carbonate + Vitamin D3",
  score: 0.9,
  ...over,
});

describe("resolveMedicineCatalog", () => {
  it("returns [] for <2 char queries and never calls the RPC", async () => {
    const { client, calls } = fakeSupabase([]);
    expect(await resolveMedicineCatalog("a", { supabase: client })).toEqual([]);
    expect(calls.fn).toBeUndefined();
  });

  it("calls resolve_medicine_catalog with a sanitised query + max_n", async () => {
    const { client, calls } = fakeSupabase([cand({})]);
    const out = await resolveMedicineCatalog("shel%cal_", { supabase: client });
    expect(calls.fn).toBe("resolve_medicine_catalog");
    expect(calls.params).toEqual({ q: "shel cal", max_n: 5 });
    expect(out).toHaveLength(1);
  });

  it("error → [] (never throws)", async () => {
    const { client } = fakeSupabase(null, { message: "boom" });
    expect(await resolveMedicineCatalog("shelcal", { supabase: client })).toEqual([]);
  });
});

describe("classifyCandidates", () => {
  it("empty → none", () => {
    expect(classifyCandidates([]).kind).toBe("none");
  });

  it("strong single top → confident", () => {
    const out = classifyCandidates([cand({ score: 0.85 })]);
    expect(out.kind).toBe("confident");
  });

  it("two strong ties → ambiguous (not confident)", () => {
    const out = classifyCandidates([cand({ score: 0.8 }), cand({ id: "m2", score: 0.8 })]);
    expect(out.kind).toBe("ambiguous");
  });

  it("mid score → ambiguous, capped at 3", () => {
    const out = classifyCandidates([
      cand({ score: 0.45 }),
      cand({ id: "m2", score: 0.4 }),
      cand({ id: "m3", score: 0.38 }),
      cand({ id: "m4", score: 0.35 }),
    ]);
    expect(out.kind).toBe("ambiguous");
    if (out.kind === "ambiguous") expect(out.candidates).toHaveLength(3);
  });

  it("below floor → none (catalogue has nothing useful → web/photo)", () => {
    expect(classifyCandidates([cand({ score: 0.2 })]).kind).toBe("none");
  });
});
