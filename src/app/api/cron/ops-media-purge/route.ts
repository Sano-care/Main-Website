import { NextResponse } from "next/server";
import { checkCronSecret } from "@/app/api/cron/_auth";
import { purgeExpiredOpsMedia } from "@/lib/whatsapp/opsMediaStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cron/ops-media-purge — retention purge for ops-viewable chat media.
 *
 * Auth: `x-cron-secret` header === CRON_SECRET (same gate as the carehub crons).
 * Deletes the ops-media object + soft-deletes the ops_media row for every item
 * whose purge_after is in the past (customer/medic = +72h, per-row TTL). Touches
 * ONLY the ops-media bucket — never pulse-documents / medic-documents / the vault.
 *
 * Wire a daily scheduler to this endpoint (the founder picks the scheduler, same
 * as the carehub crons). Idempotent: a re-run only re-scans not-yet-purged rows.
 */
export async function POST(req: Request) {
  const denied = checkCronSecret(req);
  if (denied) return denied;

  const result = await purgeExpiredOpsMedia();
  return NextResponse.json({ ok: true, sweep: "ops-media-purge", ...result });
}
