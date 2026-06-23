import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getCurrentDoctorSession } from "@/app/doctor/_lib/getCurrentDoctor";
import { istDateISO } from "@/lib/time/formatIST";

export const runtime = "nodejs";

/**
 * POST /api/consultation/presence
 *
 * Duty-Room presence heartbeat (C3). The signed-in doctor's portal calls
 * this on mount and every 60s while the tab is visible (see
 * usePresenceHeartbeat). It upserts today's doctor_presence_log row via the
 * M063 record_doctor_presence() function: the first beat of the IST day
 * stamps first_login_at; every later beat only advances last_seen_at.
 *
 * The presence→payroll bridge is entirely DB-side from here: once a SALARIED
 * doctor's in-room minutes cross 30, M063's trg_doctor_presence_to_attendance
 * creates the doctor_attendance row and M4's trg_doctor_attendance_earnings
 * posts the daily wage. This endpoint just records the heartbeat.
 *
 * Identity discipline (A1 boundary): doctor_id comes ONLY from the verified
 * `sanocare_doctor_session` cookie via getCurrentDoctorSession(). This handler
 * takes no Request and never parses a body, so a doctor_id supplied by the
 * caller has zero effect — there is no path for it to be read. Same
 * self-checking posture as /api/doctor/duty-room/start.
 *
 * Returns:
 *   200 { ok: true, first_login_at, last_seen_at, minutes_present }
 *   401 { error }  — no / invalid / expired doctor session cookie
 *   500 { error }  — supabase / clock issue
 *
 * Best-effort by design: the heartbeat client swallows non-200s and retries
 * on the next interval, so a transient failure never disrupts the doctor.
 */
export async function POST() {
  const session = await getCurrentDoctorSession();
  if (!session) {
    return NextResponse.json(
      { error: "Not signed in. Refresh /doctor and try again." },
      { status: 401 },
    );
  }

  // IST calendar date — the presence_date / work_date key. Computed app-side
  // (not in SQL) so the day boundary is the IST day and is unit-testable with
  // a fixed clock. new Date() is always valid; the null guard is defensive.
  const presenceDate = istDateISO(new Date());
  if (!presenceDate) {
    return NextResponse.json({ error: "Clock error." }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin.rpc("record_doctor_presence", {
    p_doctor_id: session.doctor_id,
    p_presence_date: presenceDate,
  });

  // The function RETURNS a single doctor_presence_log composite. PostgREST may
  // surface it as the object directly or as a one-element array depending on
  // version — normalise both.
  const row = (Array.isArray(data) ? data[0] : data) as {
    first_login_at: string;
    last_seen_at: string;
  } | null;

  if (error || !row) {
    console.error("[consult-presence] record_doctor_presence failed:", error);
    return NextResponse.json(
      { error: "Could not record presence." },
      { status: 500 },
    );
  }

  const minutesPresent = Math.max(
    0,
    (new Date(row.last_seen_at).getTime() -
      new Date(row.first_login_at).getTime()) /
      60_000,
  );

  return NextResponse.json({
    ok: true,
    first_login_at: row.first_login_at,
    last_seen_at: row.last_seen_at,
    minutes_present: Math.round(minutesPresent),
  });
}
