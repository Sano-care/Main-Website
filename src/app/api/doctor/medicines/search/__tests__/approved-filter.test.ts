// R6 regression — the doctor Rx medicine search must exclude pending/rejected
// rows so Aarogya's auto-added (pending) medicines never reach a prescriber.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/doctor/_lib/getCurrentDoctor", () => ({
  getCurrentDoctorSession: vi.fn(async () => ({ doctorId: "d1" })),
}));

const eqCalls: Array<[string, unknown]> = [];
vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (c: string, v: unknown) => {
          eqCalls.push([c, v]);
          return chain;
        },
        ilike: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: [], error: null }),
      };
      return chain;
    },
  },
}));

import { GET } from "@/app/api/doctor/medicines/search/route";

describe("GET /api/doctor/medicines/search — approved-only", () => {
  it("filters review_status=approved on every strategy", async () => {
    eqCalls.length = 0;
    const req = {
      nextUrl: { searchParams: new URLSearchParams("q=pan&limit=20") },
    } as never;
    const res = await GET(req);
    expect(res.status).toBe(200);
    const approved = eqCalls.filter(([c, v]) => c === "review_status" && v === "approved");
    expect(approved).toHaveLength(3); // prefix + brand-substring + composition strategies
  });
});
