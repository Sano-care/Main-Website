import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  customer: { id: "cust-1" } as { id: string } | null,
  deleteEqs: {} as Record<string, unknown>,
  deleteHasRow: true,
}));

vi.mock("@/app/pulse/_lib/requireCustomer", () => ({
  requirePulseCustomer: vi.fn(async () =>
    h.customer
      ? { customer: h.customer }
      : { response: new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }) },
  ),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const ctx: { op: string; eqs: Record<string, unknown> } = { op: "", eqs: {} };
      const b: Record<string, unknown> = {
        delete: () => {
          ctx.op = "delete";
          return b;
        },
        select: () => b,
        eq: (c: string, v: unknown) => {
          ctx.eqs[c] = v;
          return b;
        },
        maybeSingle: () => {
          if (ctx.op === "delete") {
            h.deleteEqs = ctx.eqs;
            return Promise.resolve({ data: h.deleteHasRow ? { id: ctx.eqs.id } : null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return b;
    },
  },
}));

import { DELETE } from "./route";

const VALID = "33333333-3333-4333-8333-333333333333";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new NextRequest("http://t/api/pulse/medications/x", { method: "DELETE" });

beforeEach(() => {
  h.customer = { id: "cust-1" };
  h.deleteEqs = {};
  h.deleteHasRow = true;
});

describe("DELETE /api/pulse/medications/:id", () => {
  it("scopes the delete to customer_id AND source='manual'", async () => {
    const res = await DELETE(req(), ctx(VALID));
    expect(res.status).toBe(200);
    expect(h.deleteEqs).toMatchObject({ id: VALID, customer_id: "cust-1", source: "manual" });
  });

  it("404 when nothing matched (clinician/imported med, or not owned)", async () => {
    h.deleteHasRow = false;
    const res = await DELETE(req(), ctx(VALID));
    expect(res.status).toBe(404);
  });

  it("invalid id → 400, no delete issued", async () => {
    const res = await DELETE(req(), ctx("not-a-uuid"));
    expect(res.status).toBe(400);
    expect(h.deleteEqs).toEqual({});
  });

  it("unauthenticated → 401", async () => {
    h.customer = null;
    const res = await DELETE(req(), ctx(VALID));
    expect(res.status).toBe(401);
    expect(h.deleteEqs).toEqual({});
  });
});
