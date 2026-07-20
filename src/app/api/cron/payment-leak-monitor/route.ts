import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkCronSecret } from "@/app/api/cron/_auth";
import { runPaymentLeakMonitor } from "@/lib/booking/paymentSafetyNet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cron/payment-leak-monitor — Razorpay revenue dead-man's switch.
 *
 * Auth: `x-cron-secret` === CRON_SECRET (fails closed). Driven by pg_cron +
 * pg_net every ~30 min. Second backstop to the /api/razorpay/webhook safety
 * net: re-alerts ops if a captured-payment reconciliation stub has sat
 * un-reconciled for >15 min, or if zero captured bookings landed in 24h after
 * the pipeline was active in the prior 24h (the original P0 symptom).
 */
export async function POST(req: Request) {
  const denied = checkCronSecret(req);
  if (denied) return denied;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Supabase server credentials missing" },
      { status: 500 },
    );
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const result = await runPaymentLeakMonitor({ supabase });
  return NextResponse.json({ ok: true, monitor: "payment-leak", ...result });
}
