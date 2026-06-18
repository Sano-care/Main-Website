import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOpsUserApi } from "@/app/ops/_lib/requireOpsAdmin";

export const runtime = "nodejs";

// T65 Phase 2B C5b — GET /api/ops/medics/[id]/attendance?days=30
//
// Read-only (admin + agent). Returns the medic's attendance rows over the
// last `days` (default 30, capped 90), newest-first, each with computed
// hours_worked and a ping_count joined from medic_location_pings on
// attendance_id. Open rows (clock_out_at null) report hours against "now".

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;

type AttendanceRow = {
  id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
};

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

  const daysRaw = Number(request.nextUrl.searchParams.get("days") ?? DEFAULT_DAYS);
  const days =
    Number.isInteger(daysRaw) && daysRaw >= 1 && daysRaw <= MAX_DAYS
      ? daysRaw
      : DEFAULT_DAYS;

  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("medic_attendance")
    .select(
      "id, clock_in_at, clock_out_at, clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng",
    )
    .eq("medic_id", medicId)
    .gte("clock_in_at", sinceIso)
    .order("clock_in_at", { ascending: false });
  if (error) {
    console.error("[ops/medics/attendance] fetch failed", error);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }

  const rows = (data ?? []) as AttendanceRow[];

  // Ping counts per attendance row. Exact HEAD counts in parallel — bounded
  // by the row count (≤ a few dozen over 90 days), so cheap and accurate
  // without transferring ping payloads.
  const countByAttendance = new Map<string, number>();
  await Promise.all(
    rows.map(async (r) => {
      const { count } = await supabaseAdmin
        .from("medic_location_pings")
        .select("id", { count: "exact", head: true })
        .eq("attendance_id", r.id);
      countByAttendance.set(r.id, count ?? 0);
    }),
  );

  const now = Date.now();
  return NextResponse.json({
    days,
    rows: rows.map((r) => {
      const inMs = new Date(r.clock_in_at).getTime();
      const outMs = r.clock_out_at ? new Date(r.clock_out_at).getTime() : now;
      const hoursWorked =
        Number.isFinite(inMs) && Number.isFinite(outMs) && outMs >= inMs
          ? (outMs - inMs) / 3_600_000
          : null;
      return {
        id: r.id,
        clock_in_at: r.clock_in_at,
        clock_out_at: r.clock_out_at,
        hours_worked: hoursWorked,
        is_open: r.clock_out_at == null,
        ping_count: countByAttendance.get(r.id) ?? 0,
      };
    }),
  });
}
