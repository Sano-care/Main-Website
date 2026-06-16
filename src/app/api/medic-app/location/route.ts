// T65 Phase 1.5 — batched location ping receiver.
//
// POST /api/medic-app/location
//   body: { pings: IncomingPing[] }
//   IncomingPing: { pinged_at: string (ISO), lat: number, lng: number,
//                   accuracy_m?: number, battery_pct?: number, speed_mps?: number }
//
// Behaviour:
//   - Auth via requireMedic (medic cookie required).
//   - Empty batch → 400 empty_batch.
//   - Batch > 50 → 400 batch_too_large (rejects suspicious payloads + protects DB).
//   - No currently-open medic_attendance row → 200 with
//     { accepted_count: 0, discarded_count: N, reason: 'no_open_attendance' }.
//     This is a SOFT FAIL: the foreground service may have a batch in flight
//     when the medic clocks out; throwing 409 would force the Android client
//     into retry loops for nothing. Server-side discard is the right semantic.
//   - On insert error → 500 (transient; client will retry next batch tick).
//
// Insert maps each ping into a row with medic_id (from cookie) + attendance_id
// (from the open row) attached server-side. Client cannot forge either.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireMedic } from "@/lib/auth/requireMedic";

export const runtime = "nodejs";

type IncomingPing = {
  pinged_at?: string;
  lat?: number;
  lng?: number;
  accuracy_m?: number;
  battery_pct?: number;
  speed_mps?: number;
};

const MAX_BATCH_SIZE = 50;

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(request: NextRequest) {
  const auth = await requireMedic(request);
  if (auth instanceof NextResponse) return auth;

  let body: { pings?: IncomingPing[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const pings = Array.isArray(body.pings) ? body.pings : [];
  if (pings.length === 0) {
    return NextResponse.json({ error: "empty_batch" }, { status: 400 });
  }
  if (pings.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: "batch_too_large", limit: MAX_BATCH_SIZE },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const { data: openAttendance, error: openErr } = await supabase
    .from("medic_attendance")
    .select("id")
    .eq("medic_id", auth.medic_id)
    .is("clock_out_at", null)
    .maybeSingle();
  if (openErr) {
    console.error("[medic-app/location] open-row lookup failed", openErr);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }

  if (!openAttendance) {
    return NextResponse.json({
      accepted_count: 0,
      discarded_count: pings.length,
      reason: "no_open_attendance",
    });
  }

  // Validate + shape each row. We do permissive coercion (drop diagnostic
  // fields that aren't finite numbers) rather than rejecting the whole batch
  // for one bad ping — adherence data is best-effort and the Android client
  // may include partial reads.
  const nowIso = new Date().toISOString();
  const rows = pings.map((p) => ({
    medic_id: auth.medic_id,
    attendance_id: openAttendance.id,
    pinged_at:
      typeof p.pinged_at === "string" && p.pinged_at.length > 0
        ? p.pinged_at
        : nowIso,
    lat: Number(p.lat),
    lng: Number(p.lng),
    accuracy_m: numericOrNull(p.accuracy_m),
    battery_pct: integerOrNull(p.battery_pct, 0, 100),
    speed_mps: numericOrNull(p.speed_mps),
  }));

  // Reject the whole batch only if lat/lng aren't usable — those are NOT NULL
  // in the schema, so a bad value would 500 anyway.
  const invalid = rows.find(
    (r) => !Number.isFinite(r.lat) || !Number.isFinite(r.lng),
  );
  if (invalid) {
    return NextResponse.json(
      { error: "invalid_coords_in_batch" },
      { status: 400 },
    );
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("medic_location_pings")
    .insert(rows)
    .select("id");
  if (insertErr || !inserted) {
    console.error("[medic-app/location] insert failed", insertErr);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json(
    {
      accepted_count: inserted.length,
      discarded_count: 0,
      accepted_at: nowIso,
    },
    { status: 201 },
  );
}

function numericOrNull(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

function integerOrNull(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const i = Math.round(v);
  if (i < min || i > max) return null;
  return i;
}
