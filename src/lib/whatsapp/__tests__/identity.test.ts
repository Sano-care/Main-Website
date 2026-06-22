// T-Aarogya-Phase1 C1 — resolveIdentity precedence + sub-role + audit-shape.
//
// External boundaries stubbed: @/lib/supabase-server (the per-table phone
// lookup) and @/lib/agent/bookings (booking-history fallback + the phone
// normalizer). The supabaseAdmin mock returns ALL rows configured for a table
// and lets resolveIdentity's own last-10 re-confirm do the matching — so these
// tests exercise the real precedence + re-confirm logic, not a stubbed verdict.

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  rows: { doctors: [], medics: [], customers: [] } as Record<
    string,
    Array<{ id: string; full_name: string | null; phone: string }>
  >,
  fromCalls: [] as string[],
  booking: { latest: null as Record<string, unknown> | null },
  // carehub_subscriptions active-membership lookup (hasActiveCarehub). Default
  // null → customer resolves to 'registered'; set to { id } for a 'carehub'.
  carehub: null as { id: string } | null,
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      h.fromCalls.push(table);
      const result = { data: h.rows[table] ?? [], error: null };
      const b: Record<string, unknown> = {
        select: () => b,
        ilike: () => b,
        eq: () => b,
        limit: () => Promise.resolve(result),
        // carehub_subscriptions reads terminate on maybeSingle.
        maybeSingle: () => Promise.resolve({ data: h.carehub, error: null }),
      };
      return b;
    },
  },
}));

vi.mock("@/lib/agent/bookings", () => ({
  normalizePhoneLast10: (p: string) => (p ?? "").replace(/\D/g, "").slice(-10),
  findBookingsByPhone: vi.fn(async () => h.booking),
}));

import { resolveIdentity, identityForAudit } from "@/lib/whatsapp/identity";

beforeEach(() => {
  h.rows = { doctors: [], medics: [], customers: [] };
  h.fromCalls = [];
  h.booking = { latest: null };
  h.carehub = null;
});

describe("resolveIdentity — precedence", () => {
  it("resolves a doctor and short-circuits before medics/customers", async () => {
    h.rows.doctors = [{ id: "doc-1", full_name: "Dr Asha", phone: "+919811100001" }];
    const id = await resolveIdentity("+919811100001");
    expect(id).toEqual({ role: "doctor", doctorId: "doc-1", fullName: "Dr Asha" });
    expect(h.fromCalls).toEqual(["doctors"]); // medics/customers never queried
  });

  it("resolves a medic (Naveen, the real prod medic) when not a doctor", async () => {
    h.rows.medics = [
      { id: "bdeff1a3-d918-4460-9960-a44aaa569fe2", full_name: "Naveen Kumar Mahavana", phone: "+917339774500" },
    ];
    const id = await resolveIdentity("+917339774500");
    expect(id).toEqual({
      role: "medic",
      medicId: "bdeff1a3-d918-4460-9960-a44aaa569fe2",
      fullName: "Naveen Kumar Mahavana",
    });
    expect(h.fromCalls).toEqual(["doctors", "medics"]);
  });

  it("doctor wins when the same number is in all three tables", async () => {
    // Slice 4a: ops_founder (+919760059900) now wins over every DB tier,
    // so this precedence test uses a non-ops phone.
    const phone = "+919811100099";
    h.rows.doctors = [{ id: "d", full_name: "D", phone }];
    h.rows.medics = [{ id: "m", full_name: "M", phone }];
    h.rows.customers = [{ id: "c", full_name: "C", phone }];
    const id = await resolveIdentity(phone);
    expect(id.role).toBe("doctor");
    expect(h.fromCalls).toEqual(["doctors"]);
  });

  it("Slice 4a — ops_founder phone short-circuits BEFORE any DB lookup", async () => {
    // Even if Shashwat has a customers row, ops_founder wins.
    h.rows.customers = [{ id: "cus-1", full_name: "Shashwat", phone: "+919760059900" }];
    const id = await resolveIdentity("+919760059900");
    expect(id).toEqual({ role: "ops_founder", phone: "+919760059900" });
    expect(h.fromCalls).toEqual([]); // no DB lookups happened
  });
});

describe("resolveIdentity — customer sub-roles", () => {
  it("a customers row → subRole 'registered' with id + name", async () => {
    // Slice 4a: switched from +919760059900 (now ops_founder) to a
    // non-ops phone so this test exercises the customers branch.
    h.rows.customers = [{ id: "cus-1", full_name: "Shashwat", phone: "+919898989898" }];
    const id = await resolveIdentity("+919898989898");
    expect(id).toEqual({
      role: "customer",
      subRole: "registered",
      customerId: "cus-1",
      fullName: "Shashwat",
    });
  });

  it("a customers row with null name omits fullName", async () => {
    h.rows.customers = [{ id: "cus-2", full_name: null, phone: "+919812341234" }];
    const id = await resolveIdentity("+919812341234");
    expect(id).toEqual({ role: "customer", subRole: "registered", customerId: "cus-2", fullName: undefined });
  });

  it("Slice 5 — a customer with an ACTIVE CareHub row → subRole 'carehub'", async () => {
    h.rows.customers = [{ id: "cus-9", full_name: "Meera", phone: "+919812300000" }];
    h.carehub = { id: "sub-1" };
    const id = await resolveIdentity("+919812300000");
    expect(id).toEqual({
      role: "customer",
      subRole: "carehub",
      customerId: "cus-9",
      fullName: "Meera",
    });
    // carehub_subscriptions is consulted only AFTER the customer match.
    expect(h.fromCalls).toEqual(["doctors", "medics", "customers", "carehub_subscriptions"]);
  });

  it("Slice 5 — carehub audit role reflects the sub-role", () => {
    expect(
      identityForAudit({ role: "customer", subRole: "carehub", customerId: "c9", fullName: "M" }),
    ).toEqual({ role: "customer:carehub", identifiers: { customer_id: "c9" } });
  });

  it("no customers row but booking history → subRole 'new' (no id)", async () => {
    h.booking = { latest: { id: "bk-1", phone: "+918888777766" } };
    const id = await resolveIdentity("+918888777766");
    expect(id).toEqual({ role: "customer", subRole: "new" });
  });
});

describe("resolveIdentity — new / edge", () => {
  it("unknown number with no booking history → role 'new'", async () => {
    const id = await resolveIdentity("+919999000011");
    expect(id).toEqual({ role: "new" });
  });

  it("too-few-digits → 'new' without touching the DB", async () => {
    const id = await resolveIdentity("123");
    expect(id).toEqual({ role: "new" });
    expect(h.fromCalls).toEqual([]);
  });

  it("matches on last-10 across +91 / spacing differences", async () => {
    h.rows.medics = [{ id: "m", full_name: "Naveen", phone: "+91 73397 74500" }];
    const id = await resolveIdentity("917339774500");
    expect(id.role).toBe("medic");
  });

  it("is stateless — a second call re-queries (no cross-call cache)", async () => {
    h.rows.doctors = [{ id: "d", full_name: "D", phone: "+919811100001" }];
    await resolveIdentity("+919811100001");
    await resolveIdentity("+919811100001");
    expect(h.fromCalls).toEqual(["doctors", "doctors"]);
  });
});

describe("identityForAudit — phone-free identifier shape", () => {
  it("doctor", () => {
    expect(identityForAudit({ role: "doctor", doctorId: "d1", fullName: "Dr" })).toEqual({
      role: "doctor",
      identifiers: { doctor_id: "d1" },
    });
  });
  it("medic", () => {
    expect(identityForAudit({ role: "medic", medicId: "m1", fullName: "N" })).toEqual({
      role: "medic",
      identifiers: { medic_id: "m1" },
    });
  });
  it("customer registered carries customer_id + sub-role in role", () => {
    expect(
      identityForAudit({ role: "customer", subRole: "registered", customerId: "c1", fullName: "S" }),
    ).toEqual({ role: "customer:registered", identifiers: { customer_id: "c1" } });
  });
  it("customer 'new' (booking-only) has empty identifiers", () => {
    expect(identityForAudit({ role: "customer", subRole: "new" })).toEqual({
      role: "customer:new",
      identifiers: {},
    });
  });
  it("new", () => {
    expect(identityForAudit({ role: "new" })).toEqual({ role: "new", identifiers: {} });
  });
});
