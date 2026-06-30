// Ad-spend ingest. upsertAdSpend is the single write seam for marketing_ad_spend,
// idempotent on (source, campaign, date) so a re-import (manual now, MCP later)
// never duplicates a day's spend. Soft-fail — a spend-import hiccup must not
// throw into the caller.

import { supabaseAdmin } from "@/lib/supabase-server";
import { log } from "@/lib/whatsapp/log";
import { MARKETING_SOURCES, type MarketingSource } from "./types";

type SupabaseLike = typeof supabaseAdmin;

export interface AdSpendInput {
  date: string; // YYYY-MM-DD
  source: MarketingSource;
  campaign: string;
  spend_paise: number;
  impressions?: number | null;
  clicks?: number | null;
  currency?: string;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate one spend row. Returns null when valid, else a reason string. */
export function validateAdSpend(row: Partial<AdSpendInput>): string | null {
  if (!row.date || !YMD_RE.test(row.date)) return "date must be YYYY-MM-DD";
  if (!row.source || !MARKETING_SOURCES.includes(row.source)) return "invalid source";
  if (!row.campaign || !row.campaign.trim()) return "campaign required";
  if (typeof row.spend_paise !== "number" || !Number.isFinite(row.spend_paise) || row.spend_paise < 0) {
    return "spend_paise must be a non-negative number";
  }
  return null;
}

export interface UpsertAdSpendDeps {
  supabase?: SupabaseLike;
}

/** Upsert one day's spend for a (source, campaign). Idempotent via the unique
 *  (source, campaign, date) constraint — a repeat import overwrites the row. */
export async function upsertAdSpend(
  input: AdSpendInput,
  deps: UpsertAdSpendDeps = {},
): Promise<{ ok: boolean; error: string | null }> {
  const supabase = deps.supabase ?? supabaseAdmin;
  const invalid = validateAdSpend(input);
  if (invalid) return { ok: false, error: invalid };

  try {
    const { error } = await supabase
      .from("marketing_ad_spend")
      .upsert(
        {
          date: input.date,
          source: input.source,
          campaign: input.campaign.trim(),
          spend_paise: Math.round(input.spend_paise),
          impressions: input.impressions ?? null,
          clicks: input.clicks ?? null,
          currency: input.currency ?? "INR",
        },
        { onConflict: "source,campaign,date" },
      );
    if (error) {
      log.error("upsertAdSpend failed", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, error: null };
  } catch (e) {
    log.error("upsertAdSpend threw", e instanceof Error ? e.message : String(e));
    return { ok: false, error: "exception" };
  }
}

/** Bulk import (CSV/JSON rows). Per-row soft-fail; returns counts + errors. */
export async function importAdSpend(
  rows: AdSpendInput[],
  deps: UpsertAdSpendDeps = {},
): Promise<{ imported: number; failed: number; errors: string[] }> {
  let imported = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const row of rows) {
    const res = await upsertAdSpend(row, deps);
    if (res.ok) imported++;
    else {
      failed++;
      errors.push(`${row.source}/${row.campaign}/${row.date}: ${res.error}`);
    }
  }
  return { imported, failed, errors };
}
