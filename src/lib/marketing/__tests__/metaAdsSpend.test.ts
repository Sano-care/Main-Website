// Meta Ads spend importer — Graph fetch (rupees→paise), token-absent inertness,
// pagination, upsert-as-meta_ctwa (dedupe on source+campaign+date), + the
// secret-gated cron route.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/whatsapp/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  maskPhone: (p: string) => p,
}));

import { fetchMetaAdSpend, importMetaAdSpend } from "@/lib/marketing/metaAdsSpend";
import { POST } from "@/app/api/cron/meta-ad-spend-import/route";

type GraphRow = Record<string, unknown>;
function graphRes(data: GraphRow[], next?: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data, paging: next ? { next } : {} }),
    text: async () => "",
  } as unknown as Response;
}

const WITH_TOKEN = { META_ADS_ACCESS_TOKEN: "tok", META_ADS_ACCOUNT_ID: "act_123" };

// Fake supabase capturing upsert(row, opts) — mirrors upsertAdSpend's call.
function fakeSpendDb() {
  const captured: { row: Record<string, unknown>; opts: Record<string, unknown> }[] = [];
  const client = {
    from: () => ({
      upsert: (row: Record<string, unknown>, opts: Record<string, unknown>) => {
        captured.push({ row, opts });
        return Promise.resolve({ error: null });
      },
    }),
  } as never;
  return { client, captured };
}

describe("fetchMetaAdSpend", () => {
  it("token/account absent → skipped, no HTTP call (inert)", async () => {
    const fetchFn = vi.fn();
    const r = await fetchMetaAdSpend({ env: {}, fetchFn: fetchFn as never });
    expect(r.skipped).toBe(true);
    expect(r.rows).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("maps Graph rupee spend → paise + campaign-level fields", async () => {
    const fetchFn = vi.fn(async () =>
      graphRes([
        { date_start: "2026-06-28", campaign_name: "Monsoon", spend: "499.50", impressions: "1000", clicks: "20" },
      ]),
    );
    const r = await fetchMetaAdSpend({
      env: WITH_TOKEN,
      fetchFn: fetchFn as never,
      now: new Date("2026-06-30T00:00:00Z"),
    });
    expect(r.skipped).toBe(false);
    expect(r.rows).toEqual([
      { date: "2026-06-28", campaign: "Monsoon", spend_paise: 49_950, impressions: 1000, clicks: 20 },
    ]);
    const url = (fetchFn.mock.calls[0] as unknown[])[0] as string;
    expect(url).toContain("/act_123/insights");
    expect(url).toContain("level=campaign");
    expect(url).toContain("time_increment=1");
  });

  it("drops rows missing date_start or campaign_name", async () => {
    const fetchFn = vi.fn(async () =>
      graphRes([{ spend: "10" }, { date_start: "2026-06-28", campaign_name: "X", spend: "0" }]),
    );
    const r = await fetchMetaAdSpend({ env: WITH_TOKEN, fetchFn: fetchFn as never });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].spend_paise).toBe(0);
  });

  it("follows Graph pagination", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        graphRes([{ date_start: "2026-06-28", campaign_name: "A", spend: "1" }], "https://graph.facebook.com/next-page"),
      )
      .mockResolvedValueOnce(graphRes([{ date_start: "2026-06-29", campaign_name: "B", spend: "2" }]));
    const r = await fetchMetaAdSpend({ env: WITH_TOKEN, fetchFn: fetchFn as never });
    expect(r.rows).toHaveLength(2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("Graph error → error surfaced, not thrown", async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}), text: async () => "bad" }) as unknown as Response);
    const r = await fetchMetaAdSpend({ env: WITH_TOKEN, fetchFn: fetchFn as never });
    expect(r.error).toBe("graph_400");
  });
});

describe("importMetaAdSpend", () => {
  it("token absent → skipped, nothing upserted", async () => {
    const { client, captured } = fakeSpendDb();
    const r = await importMetaAdSpend({ env: {}, fetchFn: vi.fn() as never, supabase: client });
    expect(r.skipped).toBe(true);
    expect(captured).toHaveLength(0);
  });

  it("upserts each row as source=meta_ctwa in paise, deduping on (source,campaign,date)", async () => {
    const { client, captured } = fakeSpendDb();
    const fetchFn = vi.fn(async () =>
      graphRes([
        { date_start: "2026-06-28", campaign_name: "Monsoon", spend: "499.50", impressions: "1000", clicks: "20" },
      ]),
    );
    const r = await importMetaAdSpend({ env: WITH_TOKEN, fetchFn: fetchFn as never, supabase: client });
    expect(r.imported).toBe(1);
    expect(captured[0].row).toMatchObject({
      source: "meta_ctwa",
      campaign: "Monsoon",
      date: "2026-06-28",
      spend_paise: 49_950,
    });
    expect(captured[0].opts).toMatchObject({ onConflict: "source,campaign,date" });
  });
});

describe("POST /api/cron/meta-ad-spend-import — secret gate", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    delete process.env.META_ADS_ACCESS_TOKEN;
    delete process.env.META_ADS_ACCOUNT_ID;
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("401 without the x-cron-secret header", async () => {
    const res = await POST(new Request("http://x/api/cron/meta-ad-spend-import", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("valid secret → 200, inert (skipped) when META token absent", async () => {
    const res = await POST(
      new Request("http://x/api/cron/meta-ad-spend-import", {
        method: "POST",
        headers: { "x-cron-secret": "s3cret" },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; skipped: boolean };
    expect(json.ok).toBe(true);
    expect(json.skipped).toBe(true);
  });
});
