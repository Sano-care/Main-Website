// T65 Phase 2 — GET /api/medic-app/duty
//
// Returns today's bookings assigned to the requesting medic (cookie-auth via
// requireMedic). Used by the Android DutyTab to render the visit list with
// status chips computed from logged events.
//
// Filter rules (founder-confirmed in plan-gate):
//   - medic_id = $1 (the cookied medic)
//   - status != 'CANCELLED' (NO_SHOW intentionally not filtered; doesn't
//     exist in the live status enum)
//   - scheduled_for IS NULL OR scheduled_for::date = $date (default today
//     IST). Unscheduled-but-active bookings surface on today's view so the
//     medic sees ASAP work.
//
// Date param: optional `?date=YYYY-MM-DD`. Default = today in IST.
// IST is fixed offset (+05:30, no DST) so a server-side compute is safe.
//
// Each row includes an `events` array (just `event` + `occurred_at`) so the
// client renders the correct status chip (Not started / On the way / Reached
// / In session / Done) without a second roundtrip per card.

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

function todayInIST(): string {
  // IST = UTC+05:30, no DST. Compute "today's date in IST" by shifting now
  // by 330 minutes and slicing YYYY-MM-DD off the ISO string.
  const nowMs = Date.now();
  const istMs = nowMs + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const auth = await requireMedic(request);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  const date =
    dateParam && DATE_RE.test(dateParam) ? dateParam : todayInIST();

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "server_misconfigured" },
      { status: 500 },
    );
  }

  // Day boundaries in UTC for the chosen IST date. Start = 00:00 IST =
  // 18:30 UTC of prior day; end = next-IST-midnight - 1 ms.
  const istStartUtc = new Date(`${date}T00:00:00+05:30`);
  const istEndUtc = new Date(istStartUtc.getTime() + 24 * 60 * 60 * 1000);

  // Pull bookings + events in parallel.
  const [bookingsRes, eventsRes] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "id, booking_code, patient_name, phone, service_category, manual_address, scheduled_for, status, gps_location",
      )
      .eq("medic_id", auth.medic_id)
      .neq("status", "CANCELLED")
      .or(
        `scheduled_for.is.null,and(scheduled_for.gte.${istStartUtc.toISOString()},scheduled_for.lt.${istEndUtc.toISOString()})`,
      )
      .order("scheduled_for", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("medic_event_log")
      .select("booking_id, event, occurred_at")
      .eq("medic_id", auth.medic_id),
  ]);

  if (bookingsRes.error) {
    console.error("[medic-app/duty] bookings lookup failed", bookingsRes.error);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (eventsRes.error) {
    console.error("[medic-app/duty] events lookup failed", eventsRes.error);
    // Soft-fail: degrade to empty events arrays. Status chips will all show
    // "Not started" but the booking list still renders.
  }

  const eventsByBooking = new Map<
    string,
    Array<{ event: string; occurred_at: string }>
  >();
  for (const row of eventsRes.data ?? []) {
    const arr = eventsByBooking.get(row.booking_id) ?? [];
    arr.push({ event: row.event, occurred_at: row.occurred_at });
    eventsByBooking.set(row.booking_id, arr);
  }

  const bookings = (bookingsRes.data ?? []).map((b) => ({
    id: b.id,
    booking_code: b.booking_code,
    patient_name: b.patient_name,
    phone: b.phone,
    service_category: b.service_category,
    manual_address: b.manual_address,
    scheduled_for: b.scheduled_for,
    status: b.status,
    gps_location: b.gps_location,
    events: eventsByBooking.get(b.id) ?? [],
  }));

  return NextResponse.json({ date, bookings });
}
