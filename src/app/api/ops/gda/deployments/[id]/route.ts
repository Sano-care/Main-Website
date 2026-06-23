import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  requireOpsAdminApi,
  requireOpsUserApi,
} from "@/app/ops/_lib/requireOpsAdmin";
import { UUID_RE, DEPLOYMENT_STATUSES } from "@/lib/gda/shared";

export const runtime = "nodejs";

// GDA Phase 1 (M064) — /api/ops/gda/deployments/[id]
//
//   GET   deployment detail: the deployment + its shifts + per-shift payout
//         (net of the gda_shift ledger rows, so a reversed shift reads ₹0).
//         Admin + agent read.
//   PATCH deployment status (active|paused|ended). Admin only.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireOpsUserApi();
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const { data: deployment, error: depErr } = await supabaseAdmin
    .from("gda_deployments")
    .select(
      "id, patient_name, address, customer_id, booking_id, shift_pattern, start_date, end_date, rate_per_shift_paise, medication_consent_at, status, created_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (depErr) {
    console.error("[ops/gda/deployments/:id] fetch failed", depErr);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
  if (!deployment) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: shifts, error: shiftErr } = await supabaseAdmin
    .from("gda_shifts")
    .select(
      "id, gda_id, shift_date, shift_kind, status, clock_in_at, clock_out_at, payout_paise, created_at",
    )
    .eq("deployment_id", id)
    .order("shift_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (shiftErr) {
    console.error("[ops/gda/deployments/:id] shifts fetch failed", shiftErr);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }

  const shiftRows = shifts ?? [];
  const shiftIds = shiftRows.map((s) => s.id);

  // Net posted payout per shift = sum of its ledger rows (gda_shift accrual +
  // any reversal). A reversed shift nets to 0; an unposted shift has no rows.
  const netByShift = new Map<string, number>();
  const gdaNames = new Map<string, string>();
  if (shiftIds.length > 0) {
    const { data: ledger } = await supabaseAdmin
      .from("medic_ledger_entries")
      .select("gda_shift_id, amount_paise")
      .in("gda_shift_id", shiftIds);
    for (const row of (ledger ?? []) as Array<{
      gda_shift_id: string | null;
      amount_paise: number;
    }>) {
      if (!row.gda_shift_id) continue;
      netByShift.set(
        row.gda_shift_id,
        (netByShift.get(row.gda_shift_id) ?? 0) + row.amount_paise,
      );
    }

    const gdaIds = Array.from(new Set(shiftRows.map((s) => s.gda_id)));
    const { data: gdas } = await supabaseAdmin
      .from("medics")
      .select("id, full_name")
      .in("id", gdaIds);
    for (const g of (gdas ?? []) as Array<{ id: string; full_name: string }>) {
      gdaNames.set(g.id, g.full_name);
    }
  }

  // Per-GDA posted-payout rollup for this deployment.
  const payoutByGda = new Map<string, number>();
  for (const s of shiftRows) {
    payoutByGda.set(
      s.gda_id,
      (payoutByGda.get(s.gda_id) ?? 0) + (netByShift.get(s.id) ?? 0),
    );
  }

  return NextResponse.json({
    deployment,
    shifts: shiftRows.map((s) => ({
      ...s,
      gda_name: gdaNames.get(s.gda_id) ?? null,
      posted_payout_paise: netByShift.get(s.id) ?? 0,
    })),
    payout_by_gda: Array.from(payoutByGda.entries()).map(([gda_id, paise]) => ({
      gda_id,
      gda_name: gdaNames.get(gda_id) ?? null,
      posted_payout_paise: paise,
    })),
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireOpsAdminApi();
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const status = String(body.status ?? "");
  if (!(DEPLOYMENT_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("gda_deployments")
    .update({ status })
    .eq("id", id);
  if (error) {
    console.error("[ops/gda/deployments/:id] status update failed", error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
