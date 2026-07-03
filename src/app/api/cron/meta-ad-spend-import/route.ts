import { NextResponse } from "next/server";
import { checkCronSecret } from "@/app/api/cron/_auth";
import { importMetaAdSpend } from "@/lib/marketing/metaAdsSpend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cron/meta-ad-spend-import — pull Meta campaign spend into
 * marketing_ad_spend so /ops/marketing reflects real Meta CAC/ROAS.
 *
 * Auth: `x-cron-secret` header === CRON_SECRET (fails closed if unset). Driven
 * by a pg_cron + pg_net job every ~6h (see the migration); can also be hit
 * manually for a smoke test. Inert until META_ADS_ACCESS_TOKEN /
 * META_ADS_ACCOUNT_ID are set — importMetaAdSpend then returns skipped=true and
 * writes nothing. Idempotent: upsertAdSpend dedupes on (source, campaign, date).
 */
export async function POST(req: Request) {
  const denied = checkCronSecret(req);
  if (denied) return denied;

  const result = await importMetaAdSpend();
  return NextResponse.json({ ok: true, sweep: "meta-ad-spend-import", ...result });
}
