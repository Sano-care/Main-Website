// Pulse Records data layer (Slice A) — account-scoping, member-filter semantics,
// best-effort reads, and the mandatory DPDP audit row.

import { describe, it, expect, vi, beforeEach } from "vitest";

// server-only is a no-op in node, but mock it so the import never trips a bundler condition.
vi.mock("server-only", () => ({}));

// Chainable supabase mock: records every .from()/.eq()/.is()/.in()/.or() so we can
// assert WHAT was queried; resolves each await to a per-table fixture.
const h = vi.hoisted(() => ({
  fixtures: {} as Record<string, { data: unknown; error: unknown }>,
  queries: [] as { table: string; filters: { method: string; args: unknown[] }[] }[],
}));

function makeBuilder(rec: { table: string; filters: { method: string; args: unknown[] }[] }) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit"]) b[m] = () => b;
  for (const m of ["eq", "is", "in", "or", "neq", "not"]) {
    b[m] = (...args: unknown[]) => {
      rec.filters.push({ method: m, args });
      return b;
    };
  }
  b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
    const fx = h.fixtures[rec.table] ?? { data: [], error: null };
    return Promise.resolve(fx).then(resolve, reject);
  };
  return b;
}

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const rec = { table, filters: [] as { method: string; args: unknown[] }[] };
      h.queries.push(rec);
      return makeBuilder(rec);
    },
  },
}));

vi.mock("@/lib/whatsapp/safety/audit", () => ({
  AuditEvent: { PULSE_RECORDS_FETCHED: "pulse_records_fetched" },
  writeAudit: vi.fn(async () => true),
}));

import { writeAudit } from "@/lib/whatsapp/safety/audit";
import { fetchPulseRecords, type PulseRecordsAudit } from "./recordsFetch";

const writeAuditMock = vi.mocked(writeAudit);

const AUDIT: PulseRecordsAudit = {
  identity: { role: "customer", identifiers: { customer_id: "cust-1" } },
  accessor: "aarogya",
  conversationId: "conv-1",
};

function queryFor(table: string) {
  return h.queries.find((q) => q.table === table);
}
function hasFilter(table: string, method: string, args: unknown[]) {
  const q = queryFor(table);
  return !!q?.filters.some((f) => f.method === method && JSON.stringify(f.args) === JSON.stringify(args));
}

beforeEach(() => {
  h.queries = [];
  writeAuditMock.mockClear();
  h.fixtures = {
    conditions: { data: [{ id: "c1", member_id: null }, { id: "c2", member_id: "m1" }], error: null },
    allergies: { data: [{ id: "a1", member_id: "m1", severity: "severe" }], error: null },
    pulse_documents: { data: [{ id: "doc1", member_id: null, doc_type: "lab_report" }], error: null },
    bookings: {
      // report_* fields present (used by fetchReports); report_url intentionally
      // NOT in the fixture — fetchReports never selects it, only filters on it.
      data: [
        {
          id: "b1",
          member_id: null,
          status: "COMPLETED",
          service_category: "lab-tests",
          report_uploaded_at: "2026-06-12T00:00:00Z",
          report_unlock_token: "rtok_123",
        },
      ],
      error: null,
    },
    payments_v: {
      data: [
        {
          booking_id: "bk1",
          booking_code: "SAN-B-1",
          service_category: "lab-tests",
          amount_paise: 120050,
          status: "CAPTURED",
          razorpay_payment_id: "pay_ABCD1234WXYZ",
          captured_at: "2026-06-10T00:00:00Z",
          created_at: "2026-06-10T00:00:00Z",
        },
      ],
      error: null,
    },
    prescriptions: {
      data: [{ id: "p1", sent_at: "2026-06-01T00:00:00Z", patient_view_token: "tok", doctor_id: "d1" }],
      error: null,
    },
    doctors: { data: [{ id: "d1", full_name: "Asha" }], error: null },
    vital_readings: {
      data: [
        { id: "v1", kind: "bp", taken_at: "2026-06-10T00:00:00Z" },
        { id: "v2", kind: "bp", taken_at: "2026-06-09T00:00:00Z" },
        { id: "v3", kind: "sugar_fasting", taken_at: "2026-06-10T00:00:00Z" },
      ],
      error: null,
    },
    medications: { data: [{ id: "med1", name: "Metformin" }], error: null },
  };
});

describe("fetchPulseRecords — account scoping", () => {
  it("filters every category by the injected customerId (never trusts other input)", async () => {
    await fetchPulseRecords("cust-1", {}, AUDIT);
    for (const t of ["bookings", "conditions", "allergies", "pulse_documents", "vital_readings", "medications"]) {
      expect(hasFilter(t, "eq", ["customer_id", "cust-1"])).toBe(true);
    }
    // prescriptions are owned via the booking join
    expect(hasFilter("prescriptions", "eq", ["bookings.customer_id", "cust-1"])).toBe(true);
  });

  it("resolves the prescription's doctor name via a batched doctors lookup", async () => {
    const res = await fetchPulseRecords("cust-1", {}, AUDIT);
    expect(res.prescriptions[0]?.doctor_name).toBe("Asha");
    expect(hasFilter("doctors", "in", ["id", ["d1"]])).toBe(true);
  });
});

describe("fetchPulseRecords — member subject filter", () => {
  it("memberId undefined → all subjects, account-level categories included", async () => {
    const res = await fetchPulseRecords("cust-1", { memberId: undefined }, AUDIT);
    // no member_id constraint added to a member-aware table
    expect(queryFor("conditions")?.filters.some((f) => f.args[0] === "member_id")).toBe(false);
    expect(queryFor("vital_readings")).toBeTruthy();
    expect(res.accountLevelOmitted).toEqual([]);
  });

  it("memberId null → account holder only (member_id IS NULL); vitals/meds included", async () => {
    await fetchPulseRecords("cust-1", { memberId: null }, AUDIT);
    expect(hasFilter("conditions", "is", ["member_id", null])).toBe(true);
    expect(hasFilter("allergies", "is", ["member_id", null])).toBe(true);
    expect(hasFilter("pulse_documents", "is", ["member_id", null])).toBe(true);
    expect(hasFilter("prescriptions", "is", ["bookings.member_id", null])).toBe(true);
    expect(queryFor("vital_readings")).toBeTruthy();
    expect(queryFor("medications")).toBeTruthy();
  });

  it("memberId = uuid → that member; account-level vitals/meds omitted, not faked", async () => {
    const res = await fetchPulseRecords("cust-1", { memberId: "m1" }, AUDIT);
    expect(hasFilter("conditions", "eq", ["member_id", "m1"])).toBe(true);
    expect(hasFilter("prescriptions", "eq", ["bookings.member_id", "m1"])).toBe(true);
    // account-level tables NOT queried at all (vitals/meds/invoices)
    expect(queryFor("vital_readings")).toBeUndefined();
    expect(queryFor("medications")).toBeUndefined();
    expect(queryFor("payments_v")).toBeUndefined();
    expect(res.vitals).toEqual([]);
    expect(res.medications).toEqual([]);
    expect(res.invoices).toEqual([]);
    expect(res.accountLevelOmitted).toEqual(["vitals", "medications", "invoices"]);
  });
});

describe("fetchPulseRecords — invoices (payments_v receipts)", () => {
  it("customer-scoped, excludes NOT_DUE, masks the payment id (full id never in the payload)", async () => {
    const res = await fetchPulseRecords("cust-1", { categories: ["invoices"] }, AUDIT);
    expect(hasFilter("payments_v", "eq", ["customer_id", "cust-1"])).toBe(true);
    // NOT_DUE = no payment occurred → excluded from the receipt list at the DB.
    expect(hasFilter("payments_v", "neq", ["status", "NOT_DUE"])).toBe(true);
    expect(res.invoices[0]?.amount_paise).toBe(120050);
    expect(res.invoices[0]?.payment_ref).toBe("•••• WXYZ");
    // DPDP: only the masked last-4 leaves the data layer — never the raw id.
    expect(JSON.stringify(res.invoices)).not.toContain("pay_ABCD1234WXYZ");
  });

  it("account-level: omitted for a specific member view, never faked", async () => {
    const res = await fetchPulseRecords("cust-1", { memberId: "m1" }, AUDIT);
    expect(queryFor("payments_v")).toBeUndefined();
    expect(res.invoices).toEqual([]);
    expect(res.accountLevelOmitted).toContain("invoices");
  });
});

describe("fetchPulseRecords — reports (bookings with a report)", () => {
  it("customer-scoped, filters report_url IS NOT NULL, and never exposes report_url", async () => {
    const res = await fetchPulseRecords("cust-1", { memberId: null, categories: ["reports"] }, AUDIT);
    expect(hasFilter("bookings", "eq", ["customer_id", "cust-1"])).toBe(true);
    expect(hasFilter("bookings", "not", ["report_url", "is", null])).toBe(true);
    // self view → account holder only
    expect(hasFilter("bookings", "is", ["member_id", null])).toBe(true);
    // only the token (the link target) is exposed; report_url never is
    expect(res.reports[0]?.report_unlock_token).toBe("rtok_123");
    expect(JSON.stringify(res.reports)).not.toContain("report_url");
  });

  it("member-aware: a specific member filters by bookings.member_id (customer scope makes a forged id match nothing)", async () => {
    await fetchPulseRecords("cust-1", { memberId: "m1", categories: ["reports"] }, AUDIT);
    expect(hasFilter("bookings", "eq", ["member_id", "m1"])).toBe(true);
    expect(hasFilter("bookings", "eq", ["customer_id", "cust-1"])).toBe(true);
  });
});

describe("fetchPulseRecords — categories + resilience", () => {
  it("honours a categories subset (queries only the requested tables)", async () => {
    await fetchPulseRecords("cust-1", { categories: ["conditions", "allergies"] }, AUDIT);
    expect(queryFor("conditions")).toBeTruthy();
    expect(queryFor("allergies")).toBeTruthy();
    expect(queryFor("bookings")).toBeUndefined();
    expect(queryFor("vital_readings")).toBeUndefined();
  });

  it("a failing category resolves to [] without throwing; others still return", async () => {
    h.fixtures.conditions = { data: null, error: { message: "boom" } };
    const res = await fetchPulseRecords("cust-1", {}, AUDIT);
    expect(res.conditions).toEqual([]);
    expect(res.allergies.length).toBe(1);
    expect(res.bookings.length).toBe(1);
  });

  it("vitals are de-duplicated to the latest reading per kind", async () => {
    const res = await fetchPulseRecords("cust-1", {}, AUDIT);
    expect(res.vitals.map((v) => v.kind)).toEqual(["bp", "sugar_fasting"]);
  });
});

describe("fetchPulseRecords — DPDP audit", () => {
  it("writes exactly one identity-aware, phone-free audit row with counts", async () => {
    await fetchPulseRecords("cust-1", { memberId: "m1" }, AUDIT);
    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    const entry = writeAuditMock.mock.calls[0][0];
    expect(entry.eventType).toBe("pulse_records_fetched");
    expect(entry.identity).toEqual(AUDIT.identity);
    expect(entry.conversationId).toBe("conv-1");
    expect(entry.eventData?.member_scope).toBe("member");
    expect(entry.eventData?.accessor).toBe("aarogya");
    expect(entry.eventData?.counts).toBeTruthy();
    // phone-free: no key or value resembling a phone number anywhere in the row
    expect(JSON.stringify(entry)).not.toMatch(/\+?\d{10,}/);
  });

  it("still audits when a specific member omits account-level categories", async () => {
    await fetchPulseRecords("cust-1", { memberId: "m1" }, AUDIT);
    const entry = writeAuditMock.mock.calls[0][0];
    expect(entry.eventData?.account_level_omitted).toEqual(["vitals", "medications", "invoices"]);
  });
});
