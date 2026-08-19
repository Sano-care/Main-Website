import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkCronSecret } from "@/app/api/cron/_auth";
import { getRazorpayClient } from "@/lib/razorpay";
import {
  reconcileRazorpayOrphans,
  type RazorpayPaymentLite,
} from "@/lib/booking/paymentSafetyNet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cron/razorpay-reconcile — active Razorpay orphan sweep.
 *
 * Auth: `x-cron-secret` === CRON_SECRET (fails closed). Driven by pg_cron every
 * ~15 min. The webhook (/api/razorpay/webhook) is the event-driven backstop,
 * but in prod it produced ZERO reconciliation stubs over 2 months — it was
 * never wired in the Razorpay dashboard, so nothing caught the captured-but-
 * unbooked payments. This route polls Razorpay directly for recently-captured
 * payments and ensures each has a booking; any orphan gets a reconciliation
 * stub + a loud ops alert. Idempotent — re-runs over the same window are no-ops
 * once a booking/stub exists.
 *
 * Optional body `{ lookbackHours }` widens the window for a one-off manual
 * sweep (capped at 30 days). Default window is 6h.
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

  // Optional wider one-off sweep via POST body.
  let lookbackMs: number | undefined;
  try {
    const body = (await req.json().catch(() => null)) as
      | { lookbackHours?: number }
      | null;
    if (body && typeof body.lookbackHours === "number" && body.lookbackHours > 0) {
      lookbackMs = Math.min(body.lookbackHours, 24 * 30) * 3600_000; // cap 30 days
    }
  } catch {
    /* no/blank body — use the default window */
  }

  try {
    const razorpay = getRazorpayClient();
    const result = await reconcileRazorpayOrphans(
      {
        supabase,
        listPayments: async (fromUnix, toUnix) => {
          // Razorpay caps `count` at 100; a 6h window won't exceed that at
          // current volume. If it ever does, the next overlapping run catches
          // the remainder (idempotent), and the cadence can be tightened.
          const page = await razorpay.payments.all({
            from: fromUnix,
            to: toUnix,
            count: 100,
          });
          const items = (page?.items ?? []) as unknown as Array<
            Record<string, unknown>
          >;
          return items.map(
            (it): RazorpayPaymentLite => ({
              id: String(it.id),
              order_id: (it.order_id as string | null) ?? null,
              status: String(it.status),
              amount: Number(it.amount) || 0,
              contact: (it.contact as string | null) ?? null,
              email: (it.email as string | null) ?? null,
            }),
          );
        },
        fetchOrderNotes: async (id) => {
          const order = await razorpay.orders.fetch(id);
          return (order?.notes || {}) as Record<string, string>;
        },
      },
      lookbackMs ? { lookbackMs } : undefined,
    );
    return NextResponse.json({ ok: true, monitor: "razorpay-reconcile", ...result });
  } catch (err) {
    console.error("[cron razorpay-reconcile] failed", err);
    return NextResponse.json(
      { error: "razorpay-reconcile failed", detail: String(err) },
      { status: 500 },
    );
  }
}
