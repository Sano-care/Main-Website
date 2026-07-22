import { NextResponse } from "next/server";
import { checkCronSecret } from "@/app/api/cron/_auth";
import {
  claimNextTurn,
  completeTurn,
  failTurn,
} from "@/lib/whatsapp/turnQueue";
import { processQueuedTurn } from "@/lib/whatsapp/adapter";
import { log } from "@/lib/whatsapp/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bounded per invocation so a burst never blows the serverless function budget;
// the 1-min cron (and the immediate webhook kick) drain the remainder.
const MAX_TURNS_PER_RUN = 25;

/**
 * POST /api/cron/aarogya-turn-drain — drain due turns from aarogya_turn_queue.
 *
 * Auth: `x-cron-secret` === CRON_SECRET (fails closed). Driven by pg_cron every
 * minute AND kicked best-effort from the webhook. Claims turns one at a time
 * (per-conversation serialized in SQL), processes each, and on failure returns
 * it to the queue for retry (fail_aarogya_turn) rather than dropping it.
 */
export async function POST(req: Request) {
  const denied = checkCronSecret(req);
  if (denied) return denied;

  let processed = 0;
  let failed = 0;
  for (let i = 0; i < MAX_TURNS_PER_RUN; i++) {
    const row = await claimNextTurn();
    if (!row) break; // nothing due
    try {
      await processQueuedTurn(row);
      await completeTurn(row.id);
      processed++;
    } catch (err) {
      const status = await failTurn(
        row.id,
        err instanceof Error ? err.message : "unknown",
      );
      failed++;
      log.error(
        "aarogya turn processing failed",
        row.id,
        `->${status}`,
        err,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    drain: "aarogya-turn",
    processed,
    failed,
  });
}
