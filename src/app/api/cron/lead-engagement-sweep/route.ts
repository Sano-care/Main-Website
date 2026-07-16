import { NextResponse } from "next/server";
import { checkCronSecret } from "@/app/api/cron/_auth";
import { runLeadEngagementSweep } from "@/lib/marketing/leadEngagement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cron/lead-engagement-sweep — Aarogya lead first-contact sweep.
 *
 * Auth: `x-cron-secret` === CRON_SECRET (fails closed). Driven by pg_cron +
 * pg_net every ~2h. Sends the throttled T1 first-contact template to eligible
 * pending leads (oldest-first, ≤10/day, <7d) + the single 48h T2 follow-up.
 * INERT until AAROGYA_LEAD_ENGAGE_ENABLED === "true"; and it refuses to send
 * while the WABA stop-loss is halted. Contact-consented sources only (DB guard).
 */
export async function POST(req: Request) {
  const denied = checkCronSecret(req);
  if (denied) return denied;

  const result = await runLeadEngagementSweep();
  return NextResponse.json({ ok: true, sweep: "lead-engagement", ...result });
}
