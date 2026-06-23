import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOpsAdminApi } from "@/app/ops/_lib/requireOpsAdmin";

export const runtime = "nodejs";

// Medic payroll — PATCH /api/ops/medics/[id]/pay-config
//
// Admin-only. Sets the medic's pay model + rates (mirror of the doctor pay-terms
// edit). NULL rates are allowed (B1) — the accrual COALESCEs them to 0, so a
// medic earns nothing until configured. Identity from the ops session.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function intPaiseOrNull(v: unknown): number | null | "invalid" {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) return "invalid";
  return n;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireOpsAdminApi();
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_medic_id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const medicType = String(body.medic_type ?? "");
  if (medicType !== "freelancer" && medicType !== "salaried") {
    return NextResponse.json({ error: "invalid_medic_type" }, { status: 400 });
  }

  const update: Record<string, unknown> = { medic_type: medicType };

  // pay_notes
  if (body.pay_notes !== undefined) {
    update.pay_notes =
      typeof body.pay_notes === "string" && body.pay_notes.trim() !== ""
        ? body.pay_notes.trim().slice(0, 500)
        : null;
  }

  // revenue_share_pct (freelancer)
  if (body.revenue_share_pct !== undefined) {
    if (body.revenue_share_pct === null) {
      update.revenue_share_pct = null;
    } else {
      const pct = Number(body.revenue_share_pct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        return NextResponse.json(
          { error: "invalid_revenue_share_pct", detail: "0–100." },
          { status: 400 },
        );
      }
      update.revenue_share_pct = pct;
    }
  }

  // Salaried rate fields (integer paise ≥ 0, or null).
  for (const key of [
    "daily_wage_paise",
    "commission_per_visit_paise",
    "overtime_hourly_paise",
  ]) {
    if (body[key] !== undefined) {
      const v = intPaiseOrNull(body[key]);
      if (v === "invalid") {
        return NextResponse.json({ error: `invalid_${key}` }, { status: 400 });
      }
      update[key] = v;
    }
  }

  const { error } = await supabaseAdmin
    .from("medics")
    .update(update)
    .eq("id", id);
  if (error) {
    console.error("[ops/medics/pay-config] update failed", error);
    return NextResponse.json(
      { error: "update_failed", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
