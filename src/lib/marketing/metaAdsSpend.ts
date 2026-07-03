// Meta Ads spend importer. Pulls campaign-level daily spend from the Graph API
// and upserts it into marketing_ad_spend (via Slice 2's upsertAdSpend — no fork)
// so /ops/marketing shows real Meta CAC/ROAS automatically.
//
// UNIT (post-#126): the Graph API returns `spend` in the account currency as a
// RUPEE string (INR); marketing_ad_spend.spend_paise is PAISE → × 100.
// Spend rows are attributed to source='meta_ctwa'.
//
// Inert by design: with META_ADS_ACCESS_TOKEN / META_ADS_ACCOUNT_ID absent, the
// fetcher no-ops (skipped=true) and nothing is written.

import { upsertAdSpend } from "./adSpend";
import type { supabaseAdmin } from "@/lib/supabase-server";
import { log } from "@/lib/whatsapp/log";

type SupabaseLike = typeof supabaseAdmin;
type FetchLike = typeof fetch;

const GRAPH_HOST = "https://graph.facebook.com";
const DEFAULT_VERSION = "v21.0";
const LOOKBACK_DAYS = 3; // re-pull a short window so late-attributed spend settles
const MAX_PAGES = 10; // safety bound on Graph pagination

export interface MetaSpendRow {
  date: string; // YYYY-MM-DD (Graph date_start)
  campaign: string;
  spend_paise: number;
  impressions: number | null;
  clicks: number | null;
}

export interface MetaFetchDeps {
  fetchFn?: FetchLike;
  env?: Record<string, string | undefined>;
  now?: Date;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface GraphInsightRow {
  date_start?: string;
  campaign_name?: string;
  spend?: string | number;
  impressions?: string | number;
  clicks?: string | number;
}

function mapRow(d: GraphInsightRow): MetaSpendRow | null {
  const date = (d.date_start ?? "").trim();
  const campaign = (d.campaign_name ?? "").trim();
  if (!date || !campaign) return null;
  const spendRupees = Number(d.spend ?? 0);
  if (!Number.isFinite(spendRupees)) return null;
  return {
    date,
    campaign,
    spend_paise: Math.round(spendRupees * 100), // rupees → paise
    impressions: d.impressions != null ? Number(d.impressions) : null,
    clicks: d.clicks != null ? Number(d.clicks) : null,
  };
}

export interface MetaFetchResult {
  rows: MetaSpendRow[];
  skipped: boolean; // true when token/account absent (inert)
  error: string | null;
}

/** Fetch the last few days of campaign-level daily spend from Meta. Returns
 *  skipped=true (no rows) when the token/account env is absent. */
export async function fetchMetaAdSpend(deps: MetaFetchDeps = {}): Promise<MetaFetchResult> {
  const env = deps.env ?? process.env;
  const token = env.META_ADS_ACCESS_TOKEN;
  const account = env.META_ADS_ACCOUNT_ID;
  if (!token || !account) {
    log.info("meta ad-spend: token/account absent — inert, no fetch");
    return { rows: [], skipped: true, error: null };
  }
  const fetchFn = deps.fetchFn ?? fetch;
  const version = env.META_ADS_API_VERSION ?? DEFAULT_VERSION;
  const now = deps.now ?? new Date();
  const until = ymd(now);
  const since = ymd(new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000));

  const params = new URLSearchParams({
    level: "campaign",
    fields: "campaign_name,spend,impressions,clicks",
    time_increment: "1", // one row per campaign per day
    time_range: JSON.stringify({ since, until }),
    limit: "500",
    access_token: token,
  });
  let url: string | null = `${GRAPH_HOST}/${version}/${account}/insights?${params.toString()}`;

  const rows: MetaSpendRow[] = [];
  try {
    for (let page = 0; page < MAX_PAGES && url; page++) {
      const res = await fetchFn(url);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        log.error("meta ad-spend: graph error", res.status, body.slice(0, 200));
        return { rows, skipped: false, error: `graph_${res.status}` };
      }
      const json = (await res.json()) as { data?: GraphInsightRow[]; paging?: { next?: string } };
      for (const d of json.data ?? []) {
        const mapped = mapRow(d);
        if (mapped) rows.push(mapped);
      }
      url = json.paging?.next ?? null;
    }
    return { rows, skipped: false, error: null };
  } catch (e) {
    log.error("meta ad-spend: fetch threw", e instanceof Error ? e.message : String(e));
    return { rows, skipped: false, error: "exception" };
  }
}

export interface ImportMetaDeps extends MetaFetchDeps {
  supabase?: SupabaseLike;
}

export interface ImportMetaResult {
  skipped: boolean;
  imported: number;
  failed: number;
  errors: string[];
}

/** Fetch Meta spend + upsert each row into marketing_ad_spend (source=meta_ctwa,
 *  idempotent on source+campaign+date via upsertAdSpend). Best-effort per row. */
export async function importMetaAdSpend(deps: ImportMetaDeps = {}): Promise<ImportMetaResult> {
  const { rows, skipped, error } = await fetchMetaAdSpend(deps);
  if (skipped) return { skipped: true, imported: 0, failed: 0, errors: [] };

  let imported = 0;
  let failed = 0;
  const errors: string[] = [];
  if (error) errors.push(`fetch: ${error}`);

  for (const row of rows) {
    const res = await upsertAdSpend(
      {
        date: row.date,
        source: "meta_ctwa",
        campaign: row.campaign,
        spend_paise: row.spend_paise,
        impressions: row.impressions,
        clicks: row.clicks,
        currency: "INR",
      },
      { supabase: deps.supabase },
    );
    if (res.ok) imported++;
    else {
      failed++;
      errors.push(`${row.campaign}/${row.date}: ${res.error}`);
    }
  }
  return { skipped: false, imported, failed, errors };
}
