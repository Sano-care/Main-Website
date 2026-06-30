import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  customer: { id: "cust-1" } as { id: string } | null,
  inserted: null as Record<string, unknown> | null,
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
      const b: Record<string, unknown> = {
        insert: (row: Record<string, unknown>) => {
          h.inserted = row;
          return b;
        },
        select: () => b,
        single: () => Promise.resolve({ data: { id: "v-1", ...h.inserted }, error: null }),
      };
      return b;
    },
  },
}));

import { POST } from "./route";

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://t/api/pulse/vitals", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  h.customer = { id: "cust-1" };
  h.inserted = null;
});

describe("POST /api/pulse/vitals", () => {
  it("forces source='manual' (ignores a client source) + scopes to the session customer", async () => {
    const res = await POST(
      postReq({ kind: "bp", value_numeric: 120, value_secondary: 80, taken_at: "2026-06-29T09:00:00Z", source: "doctor" }),
    );
    expect(res.status).toBe(201);
    expect(h.inserted).toMatchObject({
      customer_id: "cust-1",
      kind: "bp",
      value_numeric: 120,
      source: "manual", // server-set; the client's "doctor" is ignored
    });
  });

  it("unauthenticated → 401, nothing inserted", async () => {
    h.customer = null;
    const res = await POST(postReq({ kind: "bp", value_numeric: 120, taken_at: "2026-06-29T09:00:00Z" }));
    expect(res.status).toBe(401);
    expect(h.inserted).toBeNull();
  });
});
