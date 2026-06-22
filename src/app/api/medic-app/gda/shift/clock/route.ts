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
// The money path (post/reverse the gda_shift earning) is wired into clock_out /
// undo_clock_out in C4 — this commit handles the status transitions only.

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
    // C4 posts the gda_shift earning here.
    return NextResponse.json({ status: "done", clock_out_at: nowIso });
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
  // C4 reverses the gda_shift earning here.
  return NextResponse.json({ status: "in_progress", clock_out_at: null });
}
