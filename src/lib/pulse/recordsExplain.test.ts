// Pulse record explainer (Slice C) — ownership boundary (IDOR), MoHFW
// guardrails (never diagnose/prescribe/dose, always the teleconsult redirect).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { explainRecord, type ExplainRecordDeps } from "./recordsExplain";

const OWNER = "cust-1";
const REC = "11111111-2222-4333-8444-555555555555";

// A supabase mock where each table returns a row ONLY when queried with the
// matching customer_id — exactly the ownership boundary the real queries use.
// rowsByTable maps table -> the row to return when (id, customer_id) match.
const h = vi.hoisted(() => ({
  queries: [] as { table: string; eqs: Record<string, string> }[],
  rowsByTable: {} as Record<string, { row: Record<string, unknown>; customerId: string } | undefined>,
}));

function makeSupabase() {
  return {
    from: (table: string) => {
      const eqs: Record<string, string> = {};
      const rec = { table, eqs };
      h.queries.push(rec);
      const builder = {
        select: () => builder,
        is: () => builder,
        eq: (col: string, val: string) => {
          eqs[col] = val;
          return builder;
        },
        maybeSingle: () => {
          const fixture = h.rowsByTable[table];
          if (!fixture) return Promise.resolve({ data: null, error: null });
          // The ownership boundary: a row only comes back when the query's
          // customer_id (or bookings.customer_id) matches the fixture owner.
          const queriedCustomer = eqs["customer_id"] ?? eqs["bookings.customer_id"];
          if (eqs["id"] === REC && queriedCustomer === fixture.customerId) {
            return Promise.resolve({ data: fixture.row, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
}

const deps: ExplainRecordDeps = {
  supabase: makeSupabase() as unknown as ExplainRecordDeps["supabase"],
};

beforeEach(() => {
  h.queries = [];
  h.rowsByTable = {};
});

const NO_CLINICAL_VERDICT = /\b(you have|diagnos|prescrib|take \d|increase the dose|reduce the dose|titrat|is normal|is high|is low|is dangerous)\b/i;

describe("explainRecord — ownership boundary (IDOR)", () => {
  it("a record owned by ANOTHER account is never explained", async () => {
    // The vital row exists, but belongs to cust-OTHER, not the caller.
    h.rowsByTable["vital_readings"] = {
      customerId: "cust-OTHER",
      row: { id: REC, kind: "bp", value_numeric: 150, value_secondary: 95, unit: "mmHg", taken_at: "2026-06-10T00:00:00Z" },
    };
    const res = await explainRecord(OWNER, REC, deps);
    expect(res.found).toBe(false);
    expect(res.recordType).toBeNull();
    expect(res.message).toMatch(/your own Sanocare account/i);
    // crucially, the other account's value is NOT echoed
    expect(res.message).not.toContain("150");
  });

  it("an unknown / non-uuid id is refused, not explained", async () => {
    const res = await explainRecord(OWNER, "not-a-uuid", deps);
    expect(res.found).toBe(false);
    const res2 = await explainRecord(OWNER, REC, deps); // no fixture → nothing owned
    expect(res2.found).toBe(false);
    expect(res2.recordType).toBeNull();
  });
});

describe("explainRecord — MoHFW guardrails", () => {
  it("explains an OWNED vital factually + redirects to a teleconsult, no verdict", async () => {
    h.rowsByTable["vital_readings"] = {
      customerId: OWNER,
      row: { id: REC, kind: "bp", value_numeric: 150, value_secondary: 95, unit: "mmHg", taken_at: "2026-06-10T00:00:00Z" },
    };
    const res = await explainRecord(OWNER, REC, deps);
    expect(res.found).toBe(true);
    expect(res.recordType).toBe("vital");
    expect(res.message).toContain("150/95");
    expect(res.message.toLowerCase()).toContain("teleconsult");
    expect(res.message.toLowerCase()).toContain("doctor");
    expect(res.message).not.toMatch(NO_CLINICAL_VERDICT);
  });

  it("a medication is never dosed/advised — redirects to the doctor", async () => {
    h.rowsByTable["medications"] = {
      customerId: OWNER,
      row: { id: REC, name: "Metformin", dose: "500 mg" },
    };
    const res = await explainRecord(OWNER, REC, deps);
    expect(res.found).toBe(true);
    expect(res.recordType).toBe("medication");
    expect(res.message).toContain("Metformin");
    expect(res.message.toLowerCase()).toContain("doctor");
    expect(res.message).not.toMatch(NO_CLINICAL_VERDICT);
  });

  it("a document can't be read/interpreted — redirects to a teleconsult", async () => {
    h.rowsByTable["pulse_documents"] = {
      customerId: OWNER,
      row: { id: REC, doc_type: "lab_report", label: null, uploaded_at: "2026-06-09T00:00:00Z", deleted_at: null },
    };
    const res = await explainRecord(OWNER, REC, deps);
    expect(res.found).toBe(true);
    expect(res.recordType).toBe("document");
    expect(res.message.toLowerCase()).toContain("teleconsult");
    expect(res.message).not.toMatch(NO_CLINICAL_VERDICT);
  });
});
