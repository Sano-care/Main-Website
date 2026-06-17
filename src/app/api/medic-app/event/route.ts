// T65 Phase 2 — POST /api/medic-app/event
//
// Records one of the 4 visit events (departed / reached / visit_started /
// visit_done) for a booking the requesting medic owns. Append-only.
//
// Auth: requireMedic cookie. Ownership check: bookings.medic_id must equal
// the cookied medic_id.
//
// Idempotency: UNIQUE (booking_id, medic_id, event) at DB level (M052).
// On duplicate POST we return the existing event row with HTTP 200 (NOT
// 201) per founder spec — client treats both as success.
//
// Side effects: TODO(T66) — Aarogya v2 webhook fan-out lands as a separate
// workstream. Phase 2 keeps this a clean DB insert.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireMedic } from "@/lib/auth/requireMedic";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_EVENTS = new Set([
  "departed",
  "reached",
  "visit_started",
  "visit_done",
]);

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(request: NextRequest) {
  const auth = await requireMedic(request);
  if (auth instanceof NextResponse) return auth;

  let body: {
    booking_id?: string;
    event?: string;
    lat?: number;
    lng?: number;
    notes?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const bookingId = String(body.booking_id ?? "");
  if (!UUID_RE.test(bookingId)) {
    return NextResponse.json({ error: "invalid_booking_id" }, { status: 400 });
  }

  const event = String(body.event ?? "");
  if (!VALID_EVENTS.has(event)) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }

  const lat = typeof body.lat === "number" && Number.isFinite(body.lat) ? body.lat : null;
  const lng = typeof body.lng === "number" && Number.isFinite(body.lng) ? body.lng : null;
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 500) : null;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "server_misconfigured" },
      { status: 500 },
    );
  }

  // Ownership check: this medic must own this booking.
  const { data: booking, error: bookingErr } = await supabase
    .from("bookings")
    .select("id, medic_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingErr) {
    console.error("[medic-app/event] booking lookup failed", bookingErr);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!booking) {
    return NextResponse.json({ error: "booking_not_found" }, { status: 404 });
  }
  if (booking.medic_id !== auth.medic_id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Idempotency: if a row already exists for (booking, medic, event), return it.
  const { data: existing, error: existingErr } = await supabase
    .from("medic_event_log")
    .select("id, occurred_at")
    .eq("booking_id", bookingId)
    .eq("medic_id", auth.medic_id)
    .eq("event", event)
    .maybeSingle();
  if (existingErr) {
    console.error("[medic-app/event] dedupe lookup failed", existingErr);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json(
      { event_id: existing.id, recorded_at: existing.occurred_at, deduped: true },
      { status: 200 },
    );
  }

  // Fresh insert.
  const { data: inserted, error: insertErr } = await supabase
    .from("medic_event_log")
    .insert({
      booking_id: bookingId,
      medic_id: auth.medic_id,
      event,
      lat,
      lng,
      notes,
    })
    .select("id, occurred_at")
    .single();
  if (insertErr || !inserted) {
    console.error("[medic-app/event] insert failed", insertErr);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  // TODO(T66): fire Aarogya v2 webhook here — currently a no-op stub.

  return NextResponse.json(
    { event_id: inserted.id, recorded_at: inserted.occurred_at },
    { status: 201 },
  );
}
