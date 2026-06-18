import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOpsUserApi } from "@/app/ops/_lib/requireOpsAdmin";

export const runtime = "nodejs";

// T65 Phase 2B C5b — GET /api/ops/medics/[id]/location-summary?date=YYYY-MM-DD
//
// Read-only (admin + agent). For the chosen IST day: a summary card
// (ping_count, first/last ping, coverage_pct) plus the last 50 pings.
//
// coverage_pct = ping_count / expected_pings × 100, where expected =
// (clocked-in seconds that day) / 60 (the foreground service pings ~once a
// minute). Clocked-in seconds = sum over the day's attendance windows of
// (clock_out − clock_in), using "now" for a still-open row. coverage is
// null when there's no clocked-in time to measure against.
//
// No Maps embed (deferred to Phase 3 per locked dispatch).

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const PING_SAMPLE_LIMIT = 50;
const EXPECTED_PING_INTERVAL_SECONDS = 60;

function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireOpsUserApi();
  if (gate instanceof NextResponse) return gate;

  const { id: medicId } = await params;
  if (!UUID_RE.test(medicId)) {
    return NextResponse.json({ error: "invalid_medic_id" }, { status: 400 });
  }

  const dateParam = request.nextUrl.searchParams.get("date");
  const date = dateParam && DATE_RE.test(dateParam) ? dateParam : istToday();

  // IST day window in UTC (IST = UTC+05:30, no DST).
  const startUtc = new Date(`${date}T00:00:00+05:30`);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  if (!Number.isFinite(startUtc.getTime())) {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }
  const startIso = startUtc.toISOString();
  const endIso = endUtc.toISOString();

  // Pings in the window (newest-first), capped at the sample limit for the
  // table; the aggregate stats come from a separate exact count + min/max.
  const [pingRowsRes, countRes, attendanceRes] = await Promise.all([
    supabaseAdmin
      .from("medic_location_pings")
      .select("id, pinged_at, lat, lng, battery_pct, accuracy_m, speed_mps")
      .eq("medic_id", medicId)
      .gte("pinged_at", startIso)
      .lt("pinged_at", endIso)
      .order("pinged_at", { ascending: false })
      .limit(PING_SAMPLE_LIMIT),
    supabaseAdmin
      .from("medic_location_pings")
      .select("id", { count: "exact", head: true })
      .eq("medic_id", medicId)
      .gte("pinged_at", startIso)
      .lt("pinged_at", endIso),
    // Attendance rows that overlap the window (clocked in before end AND
    // clocked out after start, or still open).
    supabaseAdmin
      .from("medic_attendance")
      .select("clock_in_at, clock_out_at")
      .eq("medic_id", medicId)
      .lt("clock_in_at", endIso)
      .or(`clock_out_at.is.null,clock_out_at.gte.${startIso}`),
  ]);

  if (pingRowsRes.error || attendanceRes.error) {
    console.error(
      "[ops/medics/location-summary] fetch failed",
      pingRowsRes.error ?? attendanceRes.error,
    );
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }

  const pings = (pingRowsRes.data ?? []) as Array<{
    id: string;
    pinged_at: string;
    lat: number;
    lng: number;
    battery_pct: number | null;
    accuracy_m: number | null;
    speed_mps: number | null;
  }>;
  const pingCount = countRes.count ?? 0;

  // first/last ping in the window — derive from the (newest-first) sample
  // when the count fits the sample; otherwise query the extremes.
  let firstPingAt: string | null = null;
  let lastPingAt: string | null = null;
  if (pingCount > 0) {
    lastPingAt = pings[0]?.pinged_at ?? null; // newest in sample = window max
    if (pingCount <= PING_SAMPLE_LIMIT) {
      firstPingAt = pings[pings.length - 1]?.pinged_at ?? null;
    } else {
      const { data: earliest } = await supabaseAdmin
        .from("medic_location_pings")
        .select("pinged_at")
        .eq("medic_id", medicId)
        .gte("pinged_at", startIso)
        .lt("pinged_at", endIso)
        .order("pinged_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      firstPingAt = earliest?.pinged_at ?? null;
    }
  }

  // Clocked-in seconds within the window (clamp each attendance row to the
  // window bounds; open rows clamp to min(now, windowEnd)).
  const now = Date.now();
  const winStart = startUtc.getTime();
  const winEnd = endUtc.getTime();
  let clockedInSeconds = 0;
  for (const a of (attendanceRes.data ?? []) as Array<{
    clock_in_at: string;
    clock_out_at: string | null;
  }>) {
    const inMs = Math.max(new Date(a.clock_in_at).getTime(), winStart);
    const outRaw = a.clock_out_at ? new Date(a.clock_out_at).getTime() : now;
    const outMs = Math.min(outRaw, winEnd);
    if (Number.isFinite(inMs) && Number.isFinite(outMs) && outMs > inMs) {
      clockedInSeconds += (outMs - inMs) / 1000;
    }
  }

  const expectedPings =
    clockedInSeconds > 0
      ? clockedInSeconds / EXPECTED_PING_INTERVAL_SECONDS
      : 0;
  const coveragePct =
    expectedPings > 0
      ? Math.min(100, Math.round((pingCount / expectedPings) * 100))
      : null;

  return NextResponse.json({
    date,
    summary: {
      ping_count: pingCount,
      first_ping_at: firstPingAt,
      last_ping_at: lastPingAt,
      coverage_pct: coveragePct,
      clocked_in_minutes: Math.round(clockedInSeconds / 60),
    },
    pings: pings.map((p) => ({
      id: p.id,
      pinged_at: p.pinged_at,
      lat: p.lat,
      lng: p.lng,
      battery_pct: p.battery_pct,
      accuracy_m: p.accuracy_m,
    })),
  });
}
