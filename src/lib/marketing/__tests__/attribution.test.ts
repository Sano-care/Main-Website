// Slice 2 — attribution math (CAC/ROAS/conv, null-safe, units), ad-spend upsert
// dedupe + date filtering, and the lab-path closed-loop link.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/whatsapp/log", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  maskPhone: (p: string) => p,
}));

import {
  aggregateAttribution,
  fetchAttribution,
  type LeadAggRow,
  type SpendAggRow,
} from "@/lib/marketing/attribution";
import { upsertAdSpend, validateAdSpend } from "@/lib/marketing/adSpend";
import { linkBookingToMarketingLead } from "@/lib/marketing/closedLoop";

describe("aggregateAttribution", () => {
  const leads: LeadAggRow[] = [
    { source: "meta_ctwa", campaign: "monsoon", state: "booked", lifetime_value: 499 }, // ₹499 → 49900p
    { source: "meta_ctwa", campaign: "monsoon", state: "booked", lifetime_value: 200 },
    { source: "meta_ctwa", campaign: "monsoon", state: "hot", lifetime_value: 0 },
    { source: "meta_ctwa", campaign: "monsoon", state: "qualified", lifetime_value: 0 },
    { source: "meta_ctwa", campaign: "monsoon", state: "nurturing", lifetime_value: 0 },
    { source: "google_lead_form", campaign: "search1", state: "new", lifetime_value: 0 }, // leads, no spend
  ];
  const spend: SpendAggRow[] = [
    { source: "meta_ctwa", campaign: "monsoon", spend_paise: 100_000 }, // ₹1000
    { source: "justdial", campaign: "listing", spend_paise: 50_000 }, // spend, no leads
  ];

  it("computes counts, revenue (rupees→paise), CAC, ROAS, conv per source/campaign", () => {
    const { rows } = aggregateAttribution(leads, spend);
    const m = rows.find((r) => r.source === "meta_ctwa")!;
    expect(m.leads).toBe(5);
    expect(m.booked).toBe(2);
    expect(m.hot).toBe(1);
    expect(m.qualified).toBe(1);
    expect(m.revenue_paise).toBe(69_900); // (499 + 200) × 100
    expect(m.spend_paise).toBe(100_000);
    expect(m.cac_paise).toBe(50_000); // 100000 / 2 booked
    expect(m.roas).toBeCloseTo(0.699); // 69900 / 100000
    expect(m.conv_rate).toBeCloseTo(2 / 5);
  });

  it("is null-safe: booked=0 → CAC null; spend=0 → ROAS null; leads=0 → conv null", () => {
    const { rows } = aggregateAttribution(leads, spend);
    const g = rows.find((r) => r.source === "google_lead_form")!; // leads, no spend, no booked
    expect(g.cac_paise).toBeNull(); // no bookings
    expect(g.roas).toBeNull(); // no spend
    expect(g.conv_rate).toBe(0); // 0 booked / 1 lead

    const j = rows.find((r) => r.source === "justdial")!; // spend, no leads
    expect(j.leads).toBe(0);
    expect(j.cac_paise).toBeNull(); // no bookings
    expect(j.roas).toBe(0); // revenue 0 / spend>0 = 0 (not null — spend is present)
    expect(j.conv_rate).toBeNull(); // 0 leads
  });

  it("full-outer-joins: a spend-only campaign and a leads-only campaign both appear", () => {
    const { rows } = aggregateAttribution(leads, spend);
    expect(rows.some((r) => r.source === "justdial")).toBe(true); // spend only
    expect(rows.some((r) => r.source === "google_lead_form")).toBe(true); // leads only
  });

  it("totals roll up across all rows", () => {
    const { totals } = aggregateAttribution(leads, spend);
    expect(totals.leads).toBe(6);
    expect(totals.booked).toBe(2);
    expect(totals.revenue_paise).toBe(69_900);
    expect(totals.spend_paise).toBe(150_000);
    expect(totals.cac_paise).toBe(75_000); // 150000 / 2
  });
});

function fakeAttrSupabase(cfg: { leadRows?: unknown[]; spendRows?: unknown[] }) {
  const captured = { gte: [] as [string, string][], lte: [] as [string, string][] };
  const client = {
    from(table: string) {
      const data = table === "marketing_leads" ? cfg.leadRows ?? [] : cfg.spendRows ?? [];
      const b: Record<string, unknown> = {
        select: () => b,
        gte: (c: string, v: string) => {
          captured.gte.push([c, v]);
          return b;
        },
        lte: (c: string, v: string) => {
          captured.lte.push([c, v]);
          return b;
        },
        then: (res: (v: unknown) => void) => res({ data, error: null }),
      };
      return b;
    },
  };
  return { client: client as never, captured };
}

describe("fetchAttribution", () => {
  it("filters leads by created_at and spend by date over the range", async () => {
    const { client, captured } = fakeAttrSupabase({
      leadRows: [{ source: "meta_ctwa", campaign: "c", state: "booked", lifetime_value: 100 }],
      spendRows: [{ source: "meta_ctwa", campaign: "c", spend_paise: 10000, date: "2026-06-15" }],
    });
    const res = await fetchAttribution({ from: "2026-06-01", to: "2026-06-30" }, { supabase: client });

    expect(captured.gte).toContainEqual(["created_at", "2026-06-01"]);
    expect(captured.lte).toContainEqual(["created_at", "2026-06-30T23:59:59.999Z"]);
    expect(captured.gte).toContainEqual(["date", "2026-06-01"]);
    expect(captured.lte).toContainEqual(["date", "2026-06-30"]);
    expect(res.spendPresent).toBe(true);
    expect(res.latestSpendDate).toBe("2026-06-15");
    expect(res.rows[0].roas).toBeCloseTo(1.0); // 100×100 paise revenue / 10000 spend
  });

  it("flags spendPresent=false when no spend in range", async () => {
    const { client } = fakeAttrSupabase({ leadRows: [], spendRows: [] });
    const res = await fetchAttribution({ from: "2026-06-01", to: "2026-06-30" }, { supabase: client });
    expect(res.spendPresent).toBe(false);
    expect(res.latestSpendDate).toBeNull();
  });
});

describe("upsertAdSpend", () => {
  it("upserts idempotently on (source, campaign, date)", async () => {
    const captured: { row?: Record<string, unknown>; opts?: { onConflict?: string } } = {};
    const client = {
      from: () => ({
        upsert: (row: Record<string, unknown>, opts: { onConflict?: string }) => {
          captured.row = row;
          captured.opts = opts;
          return Promise.resolve({ error: null });
        },
      }),
    } as never;
    const res = await upsertAdSpend(
      { date: "2026-06-15", source: "meta_ctwa", campaign: " monsoon ", spend_paise: 123456.7 },
      { supabase: client },
    );
    expect(res.ok).toBe(true);
    expect(captured.opts?.onConflict).toBe("source,campaign,date");
    expect(captured.row).toMatchObject({
      date: "2026-06-15",
      source: "meta_ctwa",
      campaign: "monsoon", // trimmed
      spend_paise: 123457, // rounded
      currency: "INR",
    });
  });

  it("validateAdSpend rejects bad rows", () => {
    expect(validateAdSpend({ date: "bad", source: "meta_ctwa", campaign: "c", spend_paise: 1 })).toMatch(/date/);
    expect(validateAdSpend({ date: "2026-06-15", source: "nope" as never, campaign: "c", spend_paise: 1 })).toMatch(/source/);
    expect(validateAdSpend({ date: "2026-06-15", source: "meta_ctwa", campaign: "", spend_paise: 1 })).toMatch(/campaign/);
    expect(validateAdSpend({ date: "2026-06-15", source: "meta_ctwa", campaign: "c", spend_paise: -1 })).toMatch(/spend/);
    expect(validateAdSpend({ date: "2026-06-15", source: "meta_ctwa", campaign: "c", spend_paise: 100 })).toBeNull();
  });
});

describe("lab-path closed loop (reuses Slice 1 linkBookingToMarketingLead)", () => {
  function closedLoopFake(existing: { id: string; lifetime_value: number } | null) {
    const store: { row: Record<string, unknown> | null } = {
      row: existing ? { ...existing, state: "new", linked_booking_id: null } : null,
    };
    const client = {
      from: () => {
        let pendingUpdate: Record<string, unknown> | null = null;
        const b: Record<string, unknown> = {
          select: () => b,
          eq: () => b,
          maybeSingle: async () => ({ data: store.row, error: null }),
          update: (p: Record<string, unknown>) => {
            pendingUpdate = p;
            return b;
          },
          then: (res: (v: unknown) => void) => {
            if (pendingUpdate && store.row) Object.assign(store.row, pendingUpdate);
            res({ error: null });
          },
        };
        return b;
      },
    } as never;
    return { client, store };
  }

  it("a lab booking links to its lead → booked + lifetime_value rolled up", async () => {
    const { client, store } = closedLoopFake({ id: "ml-9", lifetime_value: 0 });
    const res = await linkBookingToMarketingLead(
      { phone: "+919812345678", bookingId: "lab-bk-1", amount: 850 }, // lab grand total (rupees)
      { supabase: client },
    );
    expect(res.linked).toBe(true);
    expect(store.row!.state).toBe("booked");
    expect(store.row!.linked_booking_id).toBe("lab-bk-1");
    expect(store.row!.lifetime_value).toBe(850);
  });

  it("soft-fail when no lead matches the lab booking phone", async () => {
    const { client } = closedLoopFake(null);
    const res = await linkBookingToMarketingLead({ phone: "+910000000000", bookingId: "lab-bk-2", amount: 850 }, { supabase: client });
    expect(res.linked).toBe(false);
  });
});
