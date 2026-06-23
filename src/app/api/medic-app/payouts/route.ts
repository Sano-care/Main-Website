import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireMedic } from "@/lib/auth/requireMedic";
import { summarizeLedger } from "@/lib/medicPayroll";

export const runtime = "nodejs";

// Medic payroll — GET /api/medic-app/payouts
//
// Feeds the Android Payouts tab (previously empty — there was no backend). Cookie
// -auth via requireMedic; the medic_id is ALWAYS the cookied medic, never a body
// param. Returns the running balance + earned/paid totals + recent ledger entries
// (newest-first) with a per-row running balance.
//
//   balance = SUM(all amount_paise)          — what we currently owe the medic
//   paid    = -SUM(payout amount_paise)      — payouts are stored negative
//   earned  = balance + paid                 — gross earned, net of reversals
//
// Read-only — the ledger is written only by the SECURITY DEFINER triggers and
// the ops Settle/adjust flows.

const PAGE_LIMIT = 100;

type LedgerRow = {
  id: string;
  entry_type: string;
  amount_paise: number;
  entry_date: string;
  description: string | null;
  created_at: string;
};

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: NextRequest) {
  const auth = await requireMedic(request);
  if (auth instanceof NextResponse) return auth;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  // Full ledger oldest-first so the per-row running balance is the true
  // cumulative figure (same approach as the ops ledger route).
  const { data, error } = await supabase
    .from("medic_ledger_entries")
    .select("id, entry_type, amount_paise, entry_date, description, created_at")
    .eq("medic_id", auth.medic_id)
    .order("entry_date", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    console.error("[medic-app/payouts] fetch failed", error);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }

  const all = (data ?? []) as LedgerRow[];

  // Per-row running balance (forward walk); totals via the shared, tested helper.
  let running = 0;
  const withBalance = all.map((r) => {
    running += r.amount_paise;
    return { ...r, running_balance_paise: running };
  });
  const summary = summarizeLedger(all);

  // Most-recent first, capped.
  const entries = withBalance
    .slice()
    .reverse()
    .slice(0, PAGE_LIMIT)
    .map((r) => ({
      id: r.id,
      entry_type: r.entry_type,
      amount_paise: r.amount_paise,
      entry_date: r.entry_date,
      description: r.description,
      running_balance_paise: r.running_balance_paise,
      created_at: r.created_at,
    }));

  return NextResponse.json({
    balance_paise: summary.balancePaise,
    total_earned_paise: summary.earnedPaise,
    total_paid_paise: summary.paidPaise,
    entries,
  });
}
