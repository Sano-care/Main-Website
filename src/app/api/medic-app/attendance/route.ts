// T65 Phase 1 — medic attendance route.
//
// GET  /api/medic-app/attendance         → returns { open: row | null }
// POST /api/medic-app/attendance         → body { action: 'clock_in' | 'clock_out',
//                                                  lat?: number, lng?: number }
//
// Append-only model. clock_in inserts a new row; clock_out updates the
// open row's clock_out_at/lat/lng. The "one open row at any time" rule
// is enforced at the route layer (the partial index
// idx_medic_attendance_open backs the lookup that gates both actions).
//
// 401 if no medic cookie; 409 if action conflicts with current state
// (already clocked in / not clocked in); 400 on invalid action.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireMedic } from "@/lib/auth/requireMedic";

export const runtime = "nodejs";

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

  const { data: open, error } = await supabase
    .from("medic_attendance")
    .select("*")
    .eq("medic_id", auth.medic_id)
    .is("clock_out_at", null)
    .maybeSingle();

  if (error) {
    console.error("[medic-app/attendance] GET lookup failed", error);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }

  return NextResponse.json({ open });
}

export async function POST(request: NextRequest) {
  const auth = await requireMedic(request);
  if (auth instanceof NextResponse) return auth;

  let body: { action?: string; lat?: number; lng?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const action = body.action;
  const lat = typeof body.lat === "number" ? body.lat : null;
  const lng = typeof body.lng === "number" ? body.lng : null;

  if (action !== "clock_in" && action !== "clock_out") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  if (action === "clock_in") {
    // Reject if already clocked in. The partial index
    // idx_medic_attendance_open makes this lookup O(1) by medic_id.
    const { data: existing, error: lookupErr } = await supabase
      .from("medic_attendance")
      .select("id")
      .eq("medic_id", auth.medic_id)
      .is("clock_out_at", null)
      .maybeSingle();
    if (lookupErr) {
      console.error("[medic-app/attendance] open-row lookup failed", lookupErr);
      return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
    }
    if (existing) {
      return NextResponse.json(
        { error: "already_clocked_in" },
        { status: 409 },
      );
    }

    const { data: row, error: insertErr } = await supabase
      .from("medic_attendance")
      .insert({
        medic_id: auth.medic_id,
        clock_in_at: new Date().toISOString(),
        clock_in_lat: lat,
        clock_in_lng: lng,
      })
      .select()
      .single();
    if (insertErr || !row) {
      console.error("[medic-app/attendance] clock-in insert failed", insertErr);
      return NextResponse.json({ error: "clock_in_failed" }, { status: 500 });
    }
    return NextResponse.json({ open: row }, { status: 201 });
  }

  // action === "clock_out"
  const { data: open, error: openErr } = await supabase
    .from("medic_attendance")
    .select("id")
    .eq("medic_id", auth.medic_id)
    .is("clock_out_at", null)
    .maybeSingle();
  if (openErr) {
    console.error("[medic-app/attendance] open-row lookup failed", openErr);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!open) {
    return NextResponse.json({ error: "not_clocked_in" }, { status: 409 });
  }

  const { data: row, error: updateErr } = await supabase
    .from("medic_attendance")
    .update({
      clock_out_at: new Date().toISOString(),
      clock_out_lat: lat,
      clock_out_lng: lng,
    })
    .eq("id", open.id)
    .select()
    .single();
  if (updateErr || !row) {
    console.error("[medic-app/attendance] clock-out update failed", updateErr);
    return NextResponse.json({ error: "clock_out_failed" }, { status: 500 });
  }

  return NextResponse.json({ open: null, last: row });
}
