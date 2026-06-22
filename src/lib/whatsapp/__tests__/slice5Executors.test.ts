// Slice 5 — unit tests for the two CareHub executors.
//
// supabaseAdmin is mocked with a small chainable builder. Per-table terminal
// results are driven by the hoisted `h` state so each test sets up exactly the
// rows it needs. Covers:
//   register_carehub_interest — member no-op, new-visitor insert, registered
//     insert (with customer_id), idempotent pending-lead reuse, insert failure
//   surface_carehub_benefits — member format, non-member gate (registered /
//     new), carehub-without-row fallback, read-error fallback

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  // carehub_leads dedupe lookup result (.maybeSingle)
  leadDedupe: null as { id: string } | null,
  // carehub_leads insert outcome
  insertError: null as { message: string } | null,
  insertedRows: [] as Record<string, unknown>[],
  // carehub_subscriptions lookup result (.maybeSingle)
  sub: null as { started_at: string; monthly_inr: number } | null,
  subError: null as { message: string } | null,
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => {
          if (table === "carehub_leads") {
            return Promise.resolve({ data: h.leadDedupe, error: null });
          }
          // carehub_subscriptions
          return Promise.resolve({ data: h.sub, error: h.subError });
        },
        insert: (row: Record<string, unknown>) => {
          h.insertedRows.push(row);
          return Promise.resolve({ error: h.insertError });
        },
      };
      return builder;
    },
  },
}));

vi.mock("@/lib/whatsapp/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  maskPhone: (p: string) => p,
}));

import {
  executeRegisterCarehubInterest,
  executeSurfaceCarehubBenefits,
} from "@/lib/whatsapp/slice5Executors";
import type { Identity } from "@/lib/whatsapp/identity";

const NEW: Identity = { role: "new" };
const REGISTERED: Identity = { role: "customer", subRole: "registered", customerId: "cus-reg" };
const CAREHUB: Identity = { role: "customer", subRole: "carehub", customerId: "cus-care" };

beforeEach(() => {
  h.leadDedupe = null;
  h.insertError = null;
  h.insertedRows = [];
  h.sub = null;
  h.subError = null;
});

describe("Slice 5 — register_carehub_interest", () => {
  it("existing member → no-op, no insert, offers to show benefits", async () => {
    const out = await executeRegisterCarehubInterest({
      identity: CAREHUB,
      phone: "+919876543210",
      input: {},
    });
    expect(out).toContain("already a CareHub member");
    expect(h.insertedRows).toHaveLength(0);
  });

  it("new visitor → inserts a lead with phone + aarogya_chat source + null customer_id", async () => {
    const out = await executeRegisterCarehubInterest({
      identity: NEW,
      phone: "+919876543210",
      input: { notes: "asked about the 199 plan" },
    });
    expect(out).toContain("noted your interest");
    expect(h.insertedRows).toHaveLength(1);
    expect(h.insertedRows[0]).toMatchObject({
      phone: "+919876543210",
      source: "aarogya_chat",
      customer_id: null,
      notes: "asked about the 199 plan",
    });
  });

  it("registered customer → lead carries their customer_id", async () => {
    await executeRegisterCarehubInterest({
      identity: REGISTERED,
      phone: "+919876500000",
      input: {},
    });
    expect(h.insertedRows).toHaveLength(1);
    expect(h.insertedRows[0]).toMatchObject({ customer_id: "cus-reg", notes: null });
  });

  it("idempotent — an existing un-actioned lead is reused, no duplicate insert", async () => {
    h.leadDedupe = { id: "lead-1" };
    const out = await executeRegisterCarehubInterest({
      identity: NEW,
      phone: "+919876543210",
      input: {},
    });
    expect(out).toContain("already on our CareHub follow-up list");
    expect(h.insertedRows).toHaveLength(0);
  });

  it("insert failure → warm fallback with the support number, never a raw error", async () => {
    h.insertError = { message: "boom" };
    const out = await executeRegisterCarehubInterest({
      identity: NEW,
      phone: "+919876543210",
      input: {},
    });
    expect(out).toContain("+91 97119 77782");
    expect(out).not.toContain("boom");
  });
});

describe("Slice 5 — surface_carehub_benefits", () => {
  it("active member → benefits string with since-date, monthly fee, and perks", async () => {
    h.sub = { started_at: "2026-06-20T08:00:00Z", monthly_inr: 199 };
    const out = await executeSurfaceCarehubBenefits(CAREHUB);
    expect(out).toContain("2026-06-20");
    expect(out).toContain("₹199/month");
    expect(out).toContain("free vitals visit");
    expect(out).toContain("20% off");
    expect(out).toContain("priority Medic dispatch");
  });

  it("registered (non-member) identity → gated out", async () => {
    const out = await executeSurfaceCarehubBenefits(REGISTERED);
    expect(out).toContain("CareHub-member feature");
    expect(h.insertedRows).toHaveLength(0);
  });

  it("new identity → gated out", async () => {
    const out = await executeSurfaceCarehubBenefits(NEW);
    expect(out).toContain("CareHub-member feature");
  });

  it("carehub identity but no active row → graceful non-member message", async () => {
    h.sub = null;
    const out = await executeSurfaceCarehubBenefits(CAREHUB);
    expect(out).toContain("CareHub-member feature");
  });

  it("read error → soft fallback, never a raw error string", async () => {
    h.subError = { message: "db down" };
    const out = await executeSurfaceCarehubBenefits(CAREHUB);
    expect(out).toContain("couldn't pull the details");
    expect(out).not.toContain("db down");
  });
});
