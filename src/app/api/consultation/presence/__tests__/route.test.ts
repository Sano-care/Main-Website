// C3 C4 — POST /api/consultation/presence handler tests.
//
// Mocks the doctor session + supabaseAdmin.rpc to verify: 401 without a
// session, the upsert is called with doctor_id FROM THE SESSION (never a
// body), the IST presence_date shape, minutes_present math, array/object
// result normalization, and 500 on rpc error.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: null as { doctor_id: string; phone?: string | null } | null,
  rpcCall: null as { fn: string; args: Record<string, unknown> } | null,
  rpcResult: null as unknown,
  rpcError: null as { message: string } | null,
}));

vi.mock("@/app/doctor/_lib/getCurrentDoctor", () => ({
  getCurrentDoctorSession: vi.fn(async () => h.session),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      h.rpcCall = { fn, args };
      return { data: h.rpcResult, error: h.rpcError };
    }),
  },
}));

import { POST } from "../route";

describe("POST /api/consultation/presence", () => {
  beforeEach(() => {
    h.session = null;
    h.rpcCall = null;
    h.rpcResult = null;
    h.rpcError = null;
  });

  it("401 when there is no doctor session, and never touches the DB", async () => {
    h.session = null;
    const res = await POST();
    expect(res.status).toBe(401);
    expect(h.rpcCall).toBeNull();
  });

  it("upserts with doctor_id from the session + IST presence_date, returns minutes_present", async () => {
    h.session = { doctor_id: "doc-salaried-1" };
    h.rpcResult = {
      first_login_at: "2026-06-22T03:00:00.000Z",
      last_seen_at: "2026-06-22T03:35:00.000Z", // +35 min
    };

    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.minutes_present).toBe(35);
    expect(h.rpcCall?.fn).toBe("record_doctor_presence");
    expect(h.rpcCall?.args.p_doctor_id).toBe("doc-salaried-1");
    expect(h.rpcCall?.args.p_presence_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("identity is session-only: the handler takes no Request, so no body can supply a doctor_id", () => {
    // Structural guarantee for the exit criterion "rejects any doctor_id in
    // the body". POST has zero parameters — there is literally no Request
    // object to parse a body from.
    expect(POST.length).toBe(0);
  });

  it("normalizes a one-element-array rpc result (PostgREST version variance)", async () => {
    h.session = { doctor_id: "d1" };
    h.rpcResult = [
      {
        first_login_at: "2026-06-22T03:00:00.000Z",
        last_seen_at: "2026-06-22T03:00:00.000Z", // 0 min — first beat
      },
    ];

    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.minutes_present).toBe(0);
  });

  it("500 when the upsert errors", async () => {
    h.session = { doctor_id: "d1" };
    h.rpcError = { message: "boom" };
    const res = await POST();
    expect(res.status).toBe(500);
  });

  it("500 when the upsert returns no row", async () => {
    h.session = { doctor_id: "d1" };
    h.rpcResult = null;
    const res = await POST();
    expect(res.status).toBe(500);
  });
});
