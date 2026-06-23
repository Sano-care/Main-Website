import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOpsAdminApi } from "@/app/ops/_lib/requireOpsAdmin";
import {
  UUID_RE,
  DATE_RE,
  SHIFT_KINDS,
  shiftKindAllowedForPattern,
  type ShiftKind,
  type ShiftPattern,
} from "@/lib/gda/shared";

export const runtime = "nodejs";

// GDA Phase 1 (M064) — POST /api/ops/gda/deployments/[id]/shifts
//
// Schedule a shift on a deployment and assign a GDA. Admin only.
//   - shift_kind must match the deployment's shift_pattern (12h → day12/night12,
//     24h → full24).
//   - the assignee must be a medic with staff_type='gda'.
//   - payout_paise (GDA pay for the shift) is an optional ops-config field — a
//     shift can be scheduled before rates are set; the accrual no-ops until it is.
//   - UNIQUE(gda_id, shift_date, shift_kind) → 409 on a double-booking.
//   - D4: a single same-day shift is valid (no minimum span).

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireOpsAdminApi();
  if (gate instanceof NextResponse) return gate;

  const { id: deploymentId } = await params;
  if (!UUID_RE.test(deploymentId)) {
    return NextResponse.json({ error: "invalid_deployment_id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const gdaId = String(body.gda_id ?? "");
  if (!UUID_RE.test(gdaId)) {
    return NextResponse.json({ error: "invalid_gda_id" }, { status: 400 });
  }

  const shiftDate = String(body.shift_date ?? "");
  if (!DATE_RE.test(shiftDate)) {
    return NextResponse.json(
      { error: "invalid_shift_date", detail: "YYYY-MM-DD." },
      { status: 400 },
    );
  }

  const shiftKind = String(body.shift_kind ?? "");
  if (!(SHIFT_KINDS as readonly string[]).includes(shiftKind)) {
    return NextResponse.json(
      { error: "invalid_shift_kind", detail: "day12, night12, or full24." },
      { status: 400 },
    );
  }

  let payoutPaise: number | null = null;
  if (body.payout_rupees != null && String(body.payout_rupees).length > 0) {
    const n = Number(body.payout_rupees);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: "invalid_payout" }, { status: 400 });
    }
    payoutPaise = Math.round(n * 100);
  }

  // Deployment must exist + be schedulable; need its pattern to validate kind.
  const { data: deployment, error: depErr } = await supabaseAdmin
    .from("gda_deployments")
    .select("id, shift_pattern, status")
    .eq("id", deploymentId)
    .maybeSingle();
  if (depErr) {
    console.error("[ops/gda/shifts] deployment lookup failed", depErr);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!deployment) {
    return NextResponse.json({ error: "deployment_not_found" }, { status: 404 });
  }
  if (deployment.status === "ended") {
    return NextResponse.json(
      { error: "deployment_ended", detail: "Cannot schedule onto an ended deployment." },
      { status: 409 },
    );
  }

  if (
    !shiftKindAllowedForPattern(
      deployment.shift_pattern as ShiftPattern,
      shiftKind as ShiftKind,
    )
  ) {
    return NextResponse.json(
      {
        error: "kind_pattern_mismatch",
        detail: `shift_kind ${shiftKind} is not valid for a ${deployment.shift_pattern} deployment.`,
      },
      { status: 400 },
    );
  }

  // Assignee must be a GDA (not a nurse).
  const { data: gda, error: gdaErr } = await supabaseAdmin
    .from("medics")
    .select("id, staff_type, active")
    .eq("id", gdaId)
    .maybeSingle();
  if (gdaErr) {
    console.error("[ops/gda/shifts] gda lookup failed", gdaErr);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!gda) {
    return NextResponse.json({ error: "gda_not_found" }, { status: 404 });
  }
  if (gda.staff_type !== "gda") {
    return NextResponse.json(
      { error: "not_a_gda", detail: "Assignee must be staff_type='gda'." },
      { status: 400 },
    );
  }

  const { data: created, error: insertErr } = await supabaseAdmin
    .from("gda_shifts")
    .insert({
      deployment_id: deploymentId,
      gda_id: gdaId,
      shift_date: shiftDate,
      shift_kind: shiftKind,
      payout_paise: payoutPaise,
      // status defaults to 'scheduled'.
    })
    .select("id")
    .single();
  if (insertErr || !created) {
    // 23505 = unique_violation on (gda_id, shift_date, shift_kind).
    if (insertErr?.code === "23505") {
      return NextResponse.json(
        { error: "shift_conflict", detail: "This GDA already has that shift kind on that date." },
        { status: 409 },
      );
    }
    console.error("[ops/gda/shifts] insert failed", insertErr);
    return NextResponse.json(
      { error: "insert_failed", detail: insertErr?.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ shift_id: created.id }, { status: 201 });
}
