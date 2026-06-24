// Pulse Records tool executors (Slice C) — identity gate, identity-from-adapter
// (never tool args), audit, and the customerId always coming from identity.

import { describe, it, expect, vi, beforeEach } from "vitest";

// identity.ts (identityForAudit) transitively imports the supabase client; stub
// it so the module loads without real env.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

// Mock the three libs the executors delegate to, so we assert the wiring +
// gating without standing up supabase/media.
const h = vi.hoisted(() => ({
  fetchArgs: [] as unknown[],
  uploadArgs: [] as unknown[],
  explainArgs: [] as { customerId: string; recordId: string }[],
  auditCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/pulse/recordsFetch", () => ({
  fetchPulseRecords: vi.fn(async (customerId: string, filter: unknown, audit: unknown) => {
    h.fetchArgs.push({ customerId, filter, audit });
    return {
      customerId,
      scope: { memberId: null },
      bookings: [{ id: "b1", member_id: null, service_category: "home-visit", status: "COMPLETED", scheduled_for: null, created_at: "2026-06-01T00:00:00Z" }],
      prescriptions: [],
      vitals: [],
      medications: [],
      conditions: [],
      allergies: [],
      documents: [],
      accountLevelOmitted: [],
    };
  }),
}));

vi.mock("@/lib/pulse/documentVault", () => ({
  uploadToPulseVault: vi.fn(async (args: { identity: { customerId?: string } }) => {
    h.uploadArgs.push(args);
    return { ok: true, message: "Saved to your records — your document.", documentId: "doc-1" };
  }),
}));

vi.mock("@/lib/pulse/recordsExplain", () => ({
  explainRecord: vi.fn(async (customerId: string, recordId: string) => {
    h.explainArgs.push({ customerId, recordId });
    return { found: true, recordType: "vital", message: "Your blood pressure… teleconsult with our MBBS doctor." };
  }),
}));

vi.mock("@/lib/whatsapp/safety/audit", () => ({
  AuditEvent: { PULSE_RECORD_EXPLAINED: "pulse_record_explained" },
  writeAudit: vi.fn(async (e: Record<string, unknown>) => {
    h.auditCalls.push(e);
    return true;
  }),
}));

import {
  executeFetchPulseRecords,
  executeUploadToPulseVault,
  executeExplainRecord,
} from "@/lib/whatsapp/pulseExecutors";
import type { Identity } from "@/lib/whatsapp/identity";

const CUSTOMER: Identity = {
  role: "customer",
  subRole: "registered",
  customerId: "cust-1",
  fullName: "Rajesh",
};
const NEW: Identity = { role: "new" };

beforeEach(() => {
  h.fetchArgs = [];
  h.uploadArgs = [];
  h.explainArgs = [];
  h.auditCalls = [];
});

describe("executeFetchPulseRecords", () => {
  it("non-customer → refusal, lib not called", async () => {
    const out = await executeFetchPulseRecords({ identity: NEW, conversationId: "c1", input: {} });
    expect(out).toMatch(/Sanocare account/i);
    expect(h.fetchArgs).toHaveLength(0);
  });

  it("customer → scopes by identity.customerId (NOT any arg) + summarises", async () => {
    const out = await executeFetchPulseRecords({
      identity: CUSTOMER,
      conversationId: "c1",
      input: { categories: ["bookings"], member_id: "mem-9" },
    });
    expect(h.fetchArgs).toHaveLength(1);
    const a = h.fetchArgs[0] as { customerId: string; filter: { memberId: string }; audit: { accessor: string } };
    expect(a.customerId).toBe("cust-1"); // from identity, always
    expect(a.filter.memberId).toBe("mem-9");
    expect(a.audit.accessor).toBe("aarogya");
    expect(out).toContain("Bookings");
  });
});

describe("executeUploadToPulseVault", () => {
  it("non-customer → refusal, lib not called", async () => {
    const out = await executeUploadToPulseVault({
      identity: NEW,
      conversationId: "c1",
      media: { mediaId: "m1", mime: "application/pdf" },
      input: {},
    });
    expect(out).toMatch(/Sanocare account/i);
    expect(h.uploadArgs).toHaveLength(0);
  });

  it("customer → passes identity + media through to the vault", async () => {
    const out = await executeUploadToPulseVault({
      identity: CUSTOMER,
      conversationId: "c1",
      media: { mediaId: "m1", mime: "application/pdf" },
      input: { doc_type: "lab_report" },
    });
    expect(h.uploadArgs).toHaveLength(1);
    const a = h.uploadArgs[0] as { identity: { customerId: string } };
    expect(a.identity.customerId).toBe("cust-1");
    expect(out).toContain("Saved to your records");
  });
});

describe("executeExplainRecord", () => {
  it("non-customer → refusal, lib not called, no audit", async () => {
    const out = await executeExplainRecord({ identity: NEW, conversationId: "c1", input: { record_id: "x" } });
    expect(out).toMatch(/Sanocare account/i);
    expect(h.explainArgs).toHaveLength(0);
    expect(h.auditCalls).toHaveLength(0);
  });

  it("customer → explains by identity.customerId + writes the DPDP audit", async () => {
    const out = await executeExplainRecord({
      identity: CUSTOMER,
      conversationId: "c1",
      input: { record_id: "rec-1" },
    });
    expect(h.explainArgs).toEqual([{ customerId: "cust-1", recordId: "rec-1" }]);
    expect(out.toLowerCase()).toContain("teleconsult");
    expect(h.auditCalls).toHaveLength(1);
    expect(h.auditCalls[0]).toMatchObject({
      eventType: "pulse_record_explained",
      identity: { role: "customer:registered", identifiers: { customer_id: "cust-1" } },
      eventData: { found: true, record_type: "vital" },
    });
  });
});
