// Catalogue self-growth — idempotent pending insert.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { addPendingMedicine } from "@/lib/medicine/catalogGrow";

function fakeSupabase(cfg: {
  existing?: { id: string } | null;
  inserted?: { id: string } | null;
  insertError?: { message: string } | null;
}) {
  const captured: { insertRow?: Record<string, unknown> } = {};
  const client = {
    from() {
      const chain = {
        select: () => chain,
        ilike: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: cfg.existing ?? null, error: null }),
        insert: (row: Record<string, unknown>) => {
          captured.insertRow = row;
          return {
            select: () => ({
              maybeSingle: async () => ({
                data: cfg.inserted ?? { id: "new-1" },
                error: cfg.insertError ?? null,
              }),
            }),
          };
        },
      };
      return chain;
    },
  };
  return { client: client as never, captured };
}

const base = {
  brandName: "Zincovit",
  composition: "Multivitamin + Zinc",
  strength: null,
  form: null,
  source: "aarogya_strip" as const,
  customerId: "cus-1",
  verifiedSource: "strip_photo",
};

describe("addPendingMedicine", () => {
  it("missing brand/composition → not added", async () => {
    const { client } = fakeSupabase({});
    const out = await addPendingMedicine({ ...base, brandName: "" }, { supabase: client });
    expect(out).toEqual({ added: false, id: null, reason: "missing_fields" });
  });

  it("already exists (any status) → skip, returns the existing id (idempotent)", async () => {
    const { client, captured } = fakeSupabase({ existing: { id: "dupe-9" } });
    const out = await addPendingMedicine(base, { supabase: client });
    expect(out).toEqual({ added: false, id: "dupe-9", reason: "exists" });
    expect(captured.insertRow).toBeUndefined(); // never inserted
  });

  it("new medicine → inserted as PENDING with provenance", async () => {
    const { client, captured } = fakeSupabase({ existing: null, inserted: { id: "grown-1" } });
    const out = await addPendingMedicine(base, { supabase: client });
    expect(out).toEqual({ added: true, id: "grown-1" });
    expect(captured.insertRow).toMatchObject({
      brand_name: "Zincovit",
      composition: "Multivitamin + Zinc",
      source: "aarogya_strip",
      review_status: "pending",
      added_by_customer_id: "cus-1",
      verified_source: "strip_photo",
    });
  });
});
