import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  customer: { id: "cust-1" } as { id: string } | null,
  createArgs: null as Record<string, unknown> | null,
}));

vi.mock("@/app/pulse/_lib/requireCustomer", () => ({
  requirePulseCustomer: vi.fn(async () =>
    h.customer
      ? { customer: h.customer }
      : { response: new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }) },
  ),
}));

vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: () => ({}) } }));

// The canonical #112 writer — mocked so we assert the route hands it source='manual'.
vi.mock("../_lib/createMedication", () => ({
  MED_SELECT: "id, name",
  createMedication: vi.fn(async (args: Record<string, unknown>) => {
    h.createArgs = args;
    return { medication: { id: "m-1", name: args.name }, intakeCount: 14 };
  }),
}));

import { POST } from "./route";

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://t/api/pulse/medications", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  h.customer = { id: "cust-1" };
  h.createArgs = null;
});

describe("POST /api/pulse/medications", () => {
  it("calls createMedication with source='manual' + the session customerId (client source ignored)", async () => {
    const res = await POST(
      postReq({ name: "Metformin", dose: "500 mg", frequency_label: "Twice daily", times_per_day: 2, source: "doctor" }),
    );
    expect(res.status).toBe(201);
    expect(h.createArgs).toMatchObject({
      customerId: "cust-1",
      name: "Metformin",
      source: "manual", // server-set; never read from the client body
    });
  });

  it("missing required fields → 400, writer not called", async () => {
    const res = await POST(postReq({ name: "Metformin" }));
    expect(res.status).toBe(400);
    expect(h.createArgs).toBeNull();
  });

  it("unauthenticated → 401", async () => {
    h.customer = null;
    const res = await POST(postReq({ name: "X", dose: "1", frequency_label: "Once daily" }));
    expect(res.status).toBe(401);
    expect(h.createArgs).toBeNull();
  });
});
