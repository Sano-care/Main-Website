import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  customer: { id: "cust-1" } as { id: string } | null,
  memberRow: null as { id: string } | null,
  inserted: [] as { table: string; row: Record<string, unknown> }[],
  insertResult: { id: "a-1" } as Record<string, unknown> | null,
  insertError: null as unknown,
  deleteCalls: [] as { table: string; eqs: Record<string, unknown> }[],
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
    from: (table: string) => {
      const ctx: { op: "select" | "insert" | "delete"; eqs: Record<string, unknown> } = {
        op: "select",
        eqs: {},
      };
      const b: Record<string, unknown> = {
        select: () => b,
        order: () => b,
        is: () => b,
        insert: (row: Record<string, unknown>) => {
          ctx.op = "insert";
          h.inserted.push({ table, row });
          return b;
        },
        delete: () => {
          ctx.op = "delete";
          return b;
        },
        eq: (col: string, val: unknown) => {
          ctx.eqs[col] = val;
          return b;
        },
        maybeSingle: () =>
          Promise.resolve({ data: table === "family_members" ? h.memberRow : null, error: null }),
        single: () =>
          Promise.resolve(
            h.insertError
              ? { data: null, error: h.insertError }
              : { data: h.insertResult ? { ...h.insertResult } : null, error: null },
          ),
        then: (resolve: (v: unknown) => void) => {
          if (ctx.op === "delete") {
            h.deleteCalls.push({ table, eqs: ctx.eqs });
            const ok = ctx.eqs.source === "patient" && h.deleteHasRow;
            return resolve({ data: ok ? [{ id: ctx.eqs.id }] : [], error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return b;
    },
  },
}));

import { POST, DELETE } from "./route";

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://t/api/pulse/allergies", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
const VALID_UUID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  h.customer = { id: "cust-1" };
  h.memberRow = null;
  h.inserted = [];
  h.insertResult = { id: "a-1" };
  h.insertError = null;
  h.deleteCalls = [];
  h.deleteHasRow = true;
});

describe("POST /api/pulse/allergies", () => {
  it("stores severity + forces source='patient', scoped to the session customer", async () => {
    const res = await POST(postReq({ label: "Penicillin", severity: "severe", reaction: "rash", source: "doctor" }));
    expect(res.status).toBe(201);
    expect(h.inserted[0].row).toMatchObject({
      customer_id: "cust-1",
      label: "Penicillin",
      severity: "severe",
      reaction: "rash",
      source: "patient",
      member_id: null,
    });
  });

  it("out-of-enum severity → 400, no insert", async () => {
    const res = await POST(postReq({ label: "X", severity: "deadly" }));
    expect(res.status).toBe(400);
    expect(h.inserted).toHaveLength(0);
  });

  it("label required → 400", async () => {
    const res = await POST(postReq({ severity: "mild" }));
    expect(res.status).toBe(400);
    expect(h.inserted).toHaveLength(0);
  });

  it("IDOR — member_id not on this customer → 400", async () => {
    h.memberRow = null;
    const res = await POST(postReq({ label: "X", member_id: "nope" }));
    expect(res.status).toBe(400);
    expect(h.inserted).toHaveLength(0);
  });

  it("unauthenticated → 401", async () => {
    h.customer = null;
    const res = await POST(postReq({ label: "X" }));
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/pulse/allergies", () => {
  it("removes only the customer's own patient-sourced row", async () => {
    h.deleteHasRow = true;
    const res = await DELETE(new NextRequest(`http://t/api/pulse/allergies?id=${VALID_UUID}`, { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(h.deleteCalls[0].eqs).toMatchObject({ id: VALID_UUID, customer_id: "cust-1", source: "patient" });
  });

  it("404 when nothing matched", async () => {
    h.deleteHasRow = false;
    const res = await DELETE(new NextRequest(`http://t/api/pulse/allergies?id=${VALID_UUID}`, { method: "DELETE" }));
    expect(res.status).toBe(404);
  });
});
