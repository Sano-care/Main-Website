// Aarogya auto-register — executor unit tests.
//
// The DB-level guarantees (generated code, idempotent no-burn, fill-if-null,
// distinct codes) are proven by the migration's rolled-back SQL check. These
// tests cover the EXECUTOR's app-layer logic with the RPC + audit mocked:
//   - name gate (placeholder/empty → nothing created, silent)
//   - phone from the INJECTED identity, never a model arg
//   - existing-id (identity.customerId) drives the UPDATE path
//   - best-effort fields passed through / nulled (bad DOB → null)
//   - phone-free audit with customer_id + source + is_new + registered

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Identity } from "@/lib/whatsapp/identity";

const h = vi.hoisted(() => ({
  rpcResult: { data: [] as unknown, error: null as { message: string } | null },
  rpcCalls: [] as Array<{ name: string; params: Record<string, unknown> }>,
  auditCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    rpc: (name: string, params: Record<string, unknown>) => {
      h.rpcCalls.push({ name, params });
      return Promise.resolve(h.rpcResult);
    },
  },
}));

vi.mock("@/lib/whatsapp/safety/audit", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/whatsapp/safety/audit")>();
  return {
    ...actual,
    writeAudit: (entry: Record<string, unknown>) => {
      h.auditCalls.push(entry);
      return Promise.resolve(true);
    },
  };
});

const { executeRegisterCustomer } = await import("@/lib/whatsapp/customerRegisterExecutor");

const NEW_IDENTITY: Identity = { role: "new" };
const REGISTERED_IDENTITY: Identity = {
  role: "customer",
  subRole: "registered",
  customerId: "cust-existing-1",
};

function okRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    data: [
      {
        customer_id: "cust-new-1",
        is_new: true,
        customer_code: "SAN-C-00035",
        full_name: "Rakesh",
        ...over,
      },
    ],
    error: null,
  };
}

beforeEach(() => {
  h.rpcCalls.length = 0;
  h.auditCalls.length = 0;
  h.rpcResult = okRow();
});

describe("executeRegisterCustomer", () => {
  it("creates a new customer: rpc with null existing id + normalised E.164 phone + name", async () => {
    await executeRegisterCustomer({
      identity: NEW_IDENTITY,
      phone: "919812345678", // digits — must be normalised to +91…
      conversationId: "conv-1",
      input: { full_name: "Rakesh" },
    });
    expect(h.rpcCalls).toHaveLength(1);
    const p = h.rpcCalls[0].params;
    expect(h.rpcCalls[0].name).toBe("aarogya_register_customer");
    expect(p.p_existing_id).toBeNull();
    expect(p.p_phone).toBe("+919812345678");
    expect(p.p_full_name).toBe("Rakesh");
  });

  it("routes the UPDATE path off identity.customerId (not a re-lookup)", async () => {
    h.rpcResult = okRow({ is_new: false, customer_id: "cust-existing-1" });
    await executeRegisterCustomer({
      identity: REGISTERED_IDENTITY,
      phone: "+919812345678",
      conversationId: "conv-1",
      input: { full_name: "Rakesh" },
    });
    expect(h.rpcCalls[0].params.p_existing_id).toBe("cust-existing-1");
  });

  it("rejects a placeholder name: nothing created, no audit (silent)", async () => {
    for (const bad of ["patient", "user", "x", "   ", ""]) {
      await executeRegisterCustomer({
        identity: NEW_IDENTITY,
        phone: "+919812345678",
        conversationId: "conv-1",
        input: { full_name: bad },
      });
    }
    expect(h.rpcCalls).toHaveLength(0);
    expect(h.auditCalls).toHaveLength(0);
  });

  it("ignores any model-supplied phone — uses the injected identity phone", async () => {
    await executeRegisterCustomer({
      identity: NEW_IDENTITY,
      phone: "+919812345678",
      conversationId: "conv-1",
      // a malicious/confused model puts a different phone in the args
      input: { full_name: "Rakesh", phone: "+919999999999" } as Record<string, unknown>,
    });
    expect(h.rpcCalls[0].params.p_phone).toBe("+919812345678");
  });

  it("passes best-effort fields through, nulls absent ones, and rejects a bad DOB", async () => {
    await executeRegisterCustomer({
      identity: NEW_IDENTITY,
      phone: "+919812345678",
      conversationId: "conv-1",
      input: {
        full_name: "Rakesh",
        city: "Delhi",
        date_of_birth: "not-a-date",
      },
    });
    const p = h.rpcCalls[0].params;
    expect(p.p_city).toBe("Delhi");
    expect(p.p_area).toBeNull();
    expect(p.p_date_of_birth).toBeNull(); // bad format → null, never blocks
  });

  it("emits a phone-free customer_registered audit with id + source + is_new", async () => {
    await executeRegisterCustomer({
      identity: NEW_IDENTITY,
      phone: "+919812345678",
      conversationId: "conv-1",
      input: { full_name: "Rakesh", city: "Delhi" },
    });
    expect(h.auditCalls).toHaveLength(1);
    const a = h.auditCalls[0];
    expect(a.eventType).toBe("customer_registered");
    const data = a.eventData as Record<string, unknown>;
    expect(data.customer_id).toBe("cust-new-1");
    expect(data.source).toBe("aarogya_whatsapp");
    expect(data.is_new_row).toBe(true);
    expect(data.registered).toBe(true);
    expect(data.fields_filled).toContain("city");
    // phone-free: no raw number anywhere in the audit payload
    expect(JSON.stringify(a)).not.toContain("919812345678");
  });

  it("soft-fails on an RPC error: no throw, no audit", async () => {
    h.rpcResult = { data: null, error: { message: "boom" } };
    await expect(
      executeRegisterCustomer({
        identity: NEW_IDENTITY,
        phone: "+919812345678",
        conversationId: "conv-1",
        input: { full_name: "Rakesh" },
      }),
    ).resolves.toBeUndefined();
    expect(h.auditCalls).toHaveLength(0);
  });

  it("marks registered=false when the row lacks a code (trio not met)", async () => {
    h.rpcResult = okRow({ customer_code: null });
    await executeRegisterCustomer({
      identity: NEW_IDENTITY,
      phone: "+919812345678",
      conversationId: "conv-1",
      input: { full_name: "Rakesh" },
    });
    expect((h.auditCalls[0].eventData as Record<string, unknown>).registered).toBe(false);
  });
});
