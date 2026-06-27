import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  customer: { id: "cust-1" } as { id: string } | null,
  memberRow: null as { id: string } | null, // family_members IDOR lookup result
  inserted: [] as { table: string; row: Record<string, unknown> }[],
  insertResult: { id: "c-1" } as Record<string, unknown> | null,
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
  return new NextRequest("http://t/api/pulse/conditions", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
function delReq(id?: string): NextRequest {
  const url = id
    ? `http://t/api/pulse/conditions?id=${id}`
    : "http://t/api/pulse/conditions";
  return new NextRequest(url, { method: "DELETE" });
}

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.customer = { id: "cust-1" };
  h.memberRow = null;
  h.inserted = [];
  h.insertResult = { id: "c-1" };
  h.insertError = null;
  h.deleteCalls = [];
  h.deleteHasRow = true;
});

describe("POST /api/pulse/conditions", () => {
  it("forces source='patient' (ignores a client-supplied source) + scopes to the session customer", async () => {
    const res = await POST(postReq({ label: "Hypertension", status: "active", source: "doctor" }));
    expect(res.status).toBe(201);
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0].row).toMatchObject({
      customer_id: "cust-1",
      label: "Hypertension",
      status: "active",
      source: "patient", // server-set; the "doctor" the client sent is ignored
      member_id: null,
    });
  });

  it("label required → 400, no insert", async () => {
    const res = await POST(postReq({ label: "   " }));
    expect(res.status).toBe(400);
    expect(h.inserted).toHaveLength(0);
  });

  it("out-of-enum status → 400 (not relying on the DB CHECK)", async () => {
    const res = await POST(postReq({ label: "X", status: "bogus" }));
    expect(res.status).toBe(400);
    expect(h.inserted).toHaveLength(0);
  });

  it("IDOR — member_id not on this customer → 400, no insert", async () => {
    h.memberRow = null;
    const res = await POST(postReq({ label: "X", member_id: "someone-else" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/family member isn't on your account/i);
    expect(h.inserted).toHaveLength(0);
  });

  it("member_id that IS on this customer → inserted with that member", async () => {
    h.memberRow = { id: "mem-9" };
    const res = await POST(postReq({ label: "X", member_id: "mem-9" }));
    expect(res.status).toBe(201);
    expect(h.inserted[0].row).toMatchObject({ member_id: "mem-9" });
  });

  it("unauthenticated → 401, no insert", async () => {
    h.customer = null;
    const res = await POST(postReq({ label: "X" }));
    expect(res.status).toBe(401);
    expect(h.inserted).toHaveLength(0);
  });
});

describe("DELETE /api/pulse/conditions", () => {
  it("removes only the customer's own patient-sourced row (scoped + source='patient')", async () => {
    h.deleteHasRow = true;
    const res = await DELETE(delReq(VALID_UUID));
    expect(res.status).toBe(200);
    expect(h.deleteCalls[0].eqs).toMatchObject({
      id: VALID_UUID,
      customer_id: "cust-1",
      source: "patient",
    });
  });

  it("404 when nothing matched (clinician row / not owned / not found)", async () => {
    h.deleteHasRow = false;
    const res = await DELETE(delReq(VALID_UUID));
    expect(res.status).toBe(404);
  });

  it("invalid id → 400", async () => {
    const res = await DELETE(delReq("not-a-uuid"));
    expect(res.status).toBe(400);
    expect(h.deleteCalls).toHaveLength(0);
  });

  it("unauthenticated → 401", async () => {
    h.customer = null;
    const res = await DELETE(delReq(VALID_UUID));
    expect(res.status).toBe(401);
  });
});
