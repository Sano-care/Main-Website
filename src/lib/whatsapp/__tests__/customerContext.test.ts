// Slice 4a C2 — loadTier1Context tests.
//
// Mirrors identity.test.ts mocking style (vi.hoisted shared state + a
// chainable supabaseAdmin mock that returns whatever rows are set up for
// the table). Branches under test:
//   - registered customer → customer + last_booking populated
//   - new visitor (no customer row, no booking) → both null
//   - customer with no bookings → customer set, last_booking null
//   - ops_founder identity → customer null (ops_founder isn't a customer)
//   - language column absent / set to a known value / set to junk
//   - carehub always null in v1 (M061 ships in Slice 5)

import { describe, it, expect, vi, beforeEach } from "vitest";

type CustomerRow = { id: string; full_name: string | null; created_at: string };
type BookingRow = {
  id: string;
  service_category: string | null;
  status: string;
  scheduled_for: string | null;
  created_at: string;
};
type ConversationRow = { id: string; language: string | null };

type CarehubRow = { started_at: string; cycle: string; monthly_inr: number };

const h = vi.hoisted(() => ({
  customers: {} as Record<string, CustomerRow | undefined>,
  bookings: {} as Record<string, BookingRow | undefined>,
  conversations: {} as Record<string, ConversationRow | undefined>,
  // carehub_subscriptions keyed by customer_id (Slice 5 / M061).
  carehub: {} as Record<string, CarehubRow | undefined>,
  bookingLookupResult: { latest: null } as {
    latest: null | { id: string; service_category: string | null; status: string; created_at: string; phone: string };
  },
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      // Track conditions by column so multi-eq queries (carehub uses
      // customer_id + active) key correctly, not just on the last eq value.
      const conds: Record<string, string> = {};
      const responder = {
        select: () => responder,
        eq: (col: string, val: string | boolean) => {
          conds[col] = String(val);
          return responder;
        },
        maybeSingle: () => {
          let data: unknown = null;
          if (table === "customers") data = conds.id ? (h.customers[conds.id] ?? null) : null;
          else if (table === "bookings") data = conds.id ? (h.bookings[conds.id] ?? null) : null;
          else if (table === "conversations") data = conds.id ? (h.conversations[conds.id] ?? null) : null;
          else if (table === "carehub_subscriptions")
            data = conds.customer_id ? (h.carehub[conds.customer_id] ?? null) : null;
          return Promise.resolve({ data, error: null });
        },
      };
      return responder;
    },
  },
}));

vi.mock("@/lib/agent/bookings", () => ({
  findBookingsByPhone: vi.fn(async () => h.bookingLookupResult),
}));

vi.mock("@/lib/whatsapp/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  maskPhone: (p: string) => p,
}));

import { loadTier1Context } from "@/lib/whatsapp/customerContext";

beforeEach(() => {
  h.customers = {};
  h.bookings = {};
  h.conversations = {};
  h.carehub = {};
  h.bookingLookupResult = { latest: null };
});

describe("loadTier1Context", () => {
  it("registered customer with a booking → customer + last_booking populated", async () => {
    h.customers["cus-1"] = {
      id: "cus-1",
      full_name: "Rajesh Kumar",
      created_at: "2026-03-15T00:00:00Z",
    };
    h.bookings["bk-1"] = {
      id: "bk-1",
      service_category: "homecare",
      status: "COMPLETED",
      scheduled_for: "2026-06-10T09:00:00Z",
      created_at: "2026-06-09T10:00:00Z",
    };
    h.bookingLookupResult = {
      latest: {
        id: "bk-1",
        service_category: "homecare",
        status: "COMPLETED",
        created_at: "2026-06-09T10:00:00Z",
        phone: "+919811100001",
      },
    };

    const ctx = await loadTier1Context(
      { role: "customer", subRole: "registered", customerId: "cus-1", fullName: "Rajesh Kumar" },
      "+919811100001",
      "conv-1",
    );

    expect(ctx.customer).toEqual({
      id: "cus-1",
      full_name: "Rajesh Kumar",
      created_at: "2026-03-15T00:00:00Z",
    });
    expect(ctx.last_booking).toEqual({
      id: "bk-1",
      service_category: "homecare",
      status: "COMPLETED",
      scheduled_for: "2026-06-10T09:00:00Z",
      created_at: "2026-06-09T10:00:00Z",
    });
    expect(ctx.carehub).toBeNull(); // always null until M061
    expect(ctx.language).toBeNull(); // conversation has no stored language
  });

  it("new visitor (no customer row, no booking history) → customer + last_booking null", async () => {
    const ctx = await loadTier1Context(
      { role: "new" },
      "+919999988888",
      "conv-new",
    );
    expect(ctx.customer).toBeNull();
    expect(ctx.last_booking).toBeNull();
    expect(ctx.carehub).toBeNull();
    expect(ctx.language).toBeNull();
  });

  it("customer with NO bookings → customer set, last_booking null", async () => {
    h.customers["cus-2"] = { id: "cus-2", full_name: "Asha", created_at: "2026-06-01T00:00:00Z" };
    // bookingLookupResult.latest stays null
    const ctx = await loadTier1Context(
      { role: "customer", subRole: "registered", customerId: "cus-2", fullName: "Asha" },
      "+919898989898",
      "conv-2",
    );
    expect(ctx.customer?.full_name).toBe("Asha");
    expect(ctx.last_booking).toBeNull();
  });

  it("ops_founder identity → customer null (the founder isn't a customer)", async () => {
    const ctx = await loadTier1Context(
      { role: "ops_founder", phone: "+919760059900" },
      "+919760059900",
      "conv-ops",
    );
    expect(ctx.customer).toBeNull();
    expect(ctx.last_booking).toBeNull();
    expect(ctx.identity.role).toBe("ops_founder");
  });

  it("doctor identity → customer null (Tier-1 is patient-context, not staff)", async () => {
    const ctx = await loadTier1Context(
      { role: "doctor", doctorId: "doc-1", fullName: "Dr Asha" },
      "+919811100001",
      "conv-doc",
    );
    expect(ctx.customer).toBeNull();
  });

  it("conversations.language='hinglish' → language returned as 'hinglish'", async () => {
    h.conversations["conv-h"] = { id: "conv-h", language: "hinglish" };
    const ctx = await loadTier1Context(
      { role: "new" },
      "+919811100001",
      "conv-h",
    );
    expect(ctx.language).toBe("hinglish");
  });

  it("conversations.language='gibberish' → language coerces to null (defensive)", async () => {
    h.conversations["conv-g"] = { id: "conv-g", language: "klingon" };
    const ctx = await loadTier1Context(
      { role: "new" },
      "+919811100001",
      "conv-g",
    );
    expect(ctx.language).toBeNull();
  });

  it("Slice 5 — active CareHub member → carehub populated from M061", async () => {
    h.customers["cus-cb"] = { id: "cus-cb", full_name: "Member", created_at: "2026-01-01T00:00:00Z" };
    h.carehub["cus-cb"] = { started_at: "2026-06-20T08:00:00Z", cycle: "monthly", monthly_inr: 199 };
    const ctx = await loadTier1Context(
      { role: "customer", subRole: "carehub", customerId: "cus-cb", fullName: "Member" },
      "+919811100002",
      "conv-cb",
    );
    expect(ctx.carehub).toEqual({
      active: true,
      cycle: "monthly",
      started_at: "2026-06-20T08:00:00Z",
      monthly_inr: 199,
    });
  });

  it("Slice 5 — customer with NO carehub row → carehub null", async () => {
    h.customers["cus-2"] = { id: "cus-2", full_name: "Asha", created_at: "2026-06-01T00:00:00Z" };
    const ctx = await loadTier1Context(
      { role: "customer", subRole: "registered", customerId: "cus-2", fullName: "Asha" },
      "+919898989898",
      "conv-2",
    );
    expect(ctx.carehub).toBeNull();
  });
});
