// Aarogya lab catalogue lookup — executor + formatting + clinical boundary.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import {
  executeSearchLabTests,
  formatLabResults,
  looksLikeSymptomQuery,
} from "@/lib/whatsapp/labExecutors";
import { AAROGYA_LAB_TOOLS, SEARCH_LAB_TESTS } from "@/lib/agent/tools";
import type { Identity } from "@/lib/whatsapp/identity";
import type { LabTestSearchRow } from "@/lib/lab/search";

const customer: Identity = { role: "customer", subRole: "registered", customerId: "c1" };
const newcomer: Identity = { role: "new" };
const medic: Identity = { role: "medic", medicId: "m1", fullName: "A" };
const doctor: Identity = { role: "doctor", doctorId: "d1", fullName: "B" };
const ops: Identity = { role: "ops_founder", phone: "+91" };

const row = (over: Partial<LabTestSearchRow>): LabTestSearchRow => ({
  code: "TSH", name: "Thyroid Profile", price_paise: 120000, sample: "3 ml whole blood in EDTA vial", tat: "1 day", category: "Endocrinology", utility: "Checks thyroid hormone levels", ...over,
});

describe("clinical boundary (advertising + role gate + symptom defer)", () => {
  it("tool is patient-only (customer + new) — AAROGYA_LAB_TOOLS = [search_lab_tests]", () => {
    expect(AAROGYA_LAB_TOOLS).toEqual([SEARCH_LAB_TESTS]);
    expect(SEARCH_LAB_TESTS.name).toBe("search_lab_tests");
  });

  it("executor refuses non-patient identities (medic/doctor/ops) — defense in depth", async () => {
    const search = vi.fn();
    for (const id of [medic, doctor, ops]) {
      const out = await executeSearchLabTests({ identity: id, input: { query: "cbc" } }, { search: search as never });
      expect(out).toMatch(/not something I can look up/i);
    }
    expect(search).not.toHaveBeenCalled();
  });

  it("symptom-style query → defers to a consult, NEVER searches/recommends", async () => {
    const search = vi.fn();
    const out = await executeSearchLabTests({ identity: customer, input: { query: "test for tiredness" } }, { search: search as never });
    expect(out).toMatch(/can't say which test you need/i);
    expect(out).toMatch(/teleconsult|doctor/i);
    expect(search).not.toHaveBeenCalled();
  });

  it("looksLikeSymptomQuery flags recommendation phrasing, not plain test names", () => {
    expect(looksLikeSymptomQuery("test for tiredness")).toBe(true);
    expect(looksLikeSymptomQuery("which test for fever")).toBe(true);
    expect(looksLikeSymptomQuery("what should i get checked")).toBe(true);
    expect(looksLikeSymptomQuery("thyroid profile")).toBe(false);
    expect(looksLikeSymptomQuery("cbc price")).toBe(false);
  });
});

describe("executeSearchLabTests results", () => {
  it("known test → name + price (₹, en-IN) + tat", async () => {
    const search = vi.fn(async () => [row({})]);
    const out = await executeSearchLabTests({ identity: customer, input: { query: "thyroid profile" } }, { search: search as never });
    expect(search).toHaveBeenCalledWith("thyroid profile", { limit: 5 });
    expect(out).toContain("Thyroid Profile");
    expect(out).toContain("₹1,200");
    expect(out).toContain("~1 day");
    expect(out).toContain("blood sample"); // summarised, not the verbose raw text
    expect(out).not.toContain("EDTA vial");
  });

  it("NULL price → 'price on request'", async () => {
    const search = vi.fn(async () => [row({ price_paise: null })]);
    const out = await executeSearchLabTests({ identity: newcomer, input: { query: "rare panel" } }, { search: search as never });
    expect(out).toMatch(/price on request/i);
  });

  it("no match → friendly reframe, no throw", async () => {
    const search = vi.fn(async () => []);
    const out = await executeSearchLabTests({ identity: customer, input: { query: "zzzzz" } }, { search: search as never });
    expect(out).toMatch(/couldn't find that one/i);
    expect(out).toMatch(/consult|test name/i);
  });

  it("search throws → graceful fallback, never propagates", async () => {
    const search = vi.fn(async () => { throw new Error("db down"); });
    const out = await executeSearchLabTests({ identity: customer, input: { query: "cbc" } }, { search: search as never });
    expect(out).toMatch(/couldn't pull that up/i);
  });

  it("empty query → asks for the test name", async () => {
    const out = await executeSearchLabTests({ identity: customer, input: { query: "" } }, { search: (vi.fn()) as never });
    expect(out).toMatch(/which test/i);
  });
});

describe("formatLabResults (pure)", () => {
  it("caps at 5 + notes booking-confirmation, never promises a total", () => {
    const rows = Array.from({ length: 8 }, (_, i) => row({ name: `Test ${i}`, code: `T${i}` }));
    const out = formatLabResults(rows, "panel");
    expect((out.match(/•/g) ?? []).length).toBe(5); // top 5 only
    expect(out).toMatch(/confirmed when you book/i);
  });
});
