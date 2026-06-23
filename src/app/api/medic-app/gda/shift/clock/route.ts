import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireMedic } from "@/lib/auth/requireMedic";
import { UUID_RE } from "@/lib/gda/shared";

export const runtime = "nodejs";

// GDA Phase 1 (M064) — POST /api/medic-app/gda/shift/clock
//
// Body: { action: 'clock_in' | 'clock_out' | 'undo_clock_out', shift_id }
//
// The GDA's own clock-in/out lives on gda_shifts (NOT medic_attendance — that's
// the nurse visit model). Cookie-auth; the shift must belong to the cookied GDA.
// Status machine: scheduled → in_progress (clock_in) → done (clock_out), with
// undo_clock_out reverting done → in_progress.
//
// clock_out posts the gda_shift earning (post_gda_shift_earning, idempotent),
// undo_clock_out reverses it (reverse_gda_shift_earning, append-only). Both DB
// functions are SECURITY DEFINER + idempotent, so a retried request never
// double-posts.

const ACTIONS = new Set(["clock_in", "clock_out", "undo_clock_out"]);

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(request: NextRequest) {
  const auth = await requireMedic(request);
  if (auth instanceof NextResponse) return auth;

  let body: { action?: string; shift_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const action = String(body.action ?? "");
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }
  const shiftId = String(body.shift_id ?? "");
  if (!UUID_RE.test(shiftId)) {
    return NextResponse.json({ error: "invalid_shift_id" }, { status: 400 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  // Ownership + current state. The gda_id filter guarantees a GDA can only clock
  // their OWN shift, regardless of the shift_id in the body.
  const { data: shift, error: lookupErr } = await supabase
    .from("gda_shifts")
    .select("id, status")
    .eq("id", shiftId)
    .eq("gda_id", auth.medic_id)
    .maybeSingle();
  if (lookupErr) {
    console.error("[medic-app/gda/clock] lookup failed", lookupErr);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!shift) {
    return NextResponse.json({ error: "shift_not_found" }, { status: 404 });
  }

  const nowIso = new Date().toISOString();

  if (action === "clock_in") {
    if (shift.status !== "scheduled") {
      return NextResponse.json(
        { error: "bad_state", detail: `Cannot clock in from '${shift.status}'.` },
        { status: 409 },
      );
    }
    const { error } = await supabase
      .from("gda_shifts")
      .update({ clock_in_at: nowIso, status: "in_progress" })
      .eq("id", shiftId);
    if (error) {
      console.error("[medic-app/gda/clock] clock_in failed", error);
      return NextResponse.json({ error: "update_failed" }, { status: 500 });
    }
    return NextResponse.json({ status: "in_progress", clock_in_at: nowIso });
  }

  if (action === "clock_out") {
    if (shift.status !== "in_progress") {
      return NextResponse.json(
        { error: "bad_state", detail: `Cannot clock out from '${shift.status}'.` },
        { status: 409 },
      );
    }
    const { error } = await supabase
      .from("gda_shifts")
      .update({ clock_out_at: nowIso, status: "done" })
      .eq("id", shiftId);
    if (error) {
      console.error("[medic-app/gda/clock] clock_out failed", error);
      return NextResponse.json({ error: "update_failed" }, { status: 500 });
    }
    // Money path — post the shift earning. Idempotent + append-only in the DB
    // function (one 'gda_shift' row per shift; no-op if already posted or if no
    // payout is configured yet). Best-effort: the clock-out itself stands even
    // if the post is deferred — re-running it is a no-op, so nothing double-pays.
    const { data: ledgerId, error: rpcErr } = await supabase.rpc(
      "post_gda_shift_earning",
      { p_shift_id: shiftId },
    );
    if (rpcErr) {
      console.error("[medic-app/gda/clock] payout post failed", rpcErr);
      return NextResponse.json({
        status: "done",
        clock_out_at: nowIso,
        payout_posted: false,
        warning: "payout_post_deferred",
      });
    }
    return NextResponse.json({
      status: "done",
      clock_out_at: nowIso,
      ledger_entry_id: (ledgerId as string | null) ?? null,
      payout_posted: ledgerId != null,
    });
  }

  // undo_clock_out
  if (shift.status !== "done") {
    return NextResponse.json(
      { error: "bad_state", detail: `Nothing to undo from '${shift.status}'.` },
      { status: 409 },
    );
  }
  const { error } = await supabase
    .from("gda_shifts")
    .update({ clock_out_at: null, status: "in_progress" })
    .eq("id", shiftId);
  if (error) {
    console.error("[medic-app/gda/clock] undo failed", error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  // Money path — reverse the shift earning (append-only: posts a compensating
  // 'reversal' row, never UPDATE/DELETE). Idempotent + no-op if nothing accrued.
  const { data: revId, error: rpcErr } = await supabase.rpc(
    "reverse_gda_shift_earning",
    { p_shift_id: shiftId },
  );
  if (rpcErr) {
    console.error("[medic-app/gda/clock] payout reversal failed", rpcErr);
    return NextResponse.json({
      status: "in_progress",
      clock_out_at: null,
      reversal_posted: false,
      warning: "reversal_deferred",
    });
  }
  return NextResponse.json({
    status: "in_progress",
    clock_out_at: null,
    reversal_entry_id: (revId as string | null) ?? null,
  });
}
