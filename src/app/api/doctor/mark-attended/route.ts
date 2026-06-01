import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getCurrentDoctorSession } from "@/app/doctor/_lib/getCurrentDoctor";

export const runtime = "nodejs";

/**
 * POST /api/doctor/mark-attended
 *
 * Clinic-lobby control (PR #22 redirect, Task #43): formally close
 * the consult by stamping consultation_sessions.ended_at = now(). The
 * patient's useSessionAdmitState hook sees endedAt flip non-null and
 * PatientJoinClient unmounts the Daily iframe + renders the Sanocare
 * post-consult screen.
 *
 * Body: { session_id: string }
 *
 * Returns:
 *   200 { ok: true, ended_at: string, already_attended?: true }
 *     - Fresh write returns the new timestamp.
 *     - Idempotent re-click (ended_at already set) returns the
 *       existing value + already_attended=true.
 *   400 { error }   — bad body / no such session
 *   401 { error }   — no doctor session cookie
 *   403 { error }   — session belongs to a different doctor
 *   500 { error }   — db issue
 *
 * Idempotency: the UPDATE filters by id + ended_at IS NULL. Re-click
 * matches 0 rows and we return the existing ended_at — caller treats
 * both as success.
 *
 * Note on session.status: M021 schema has a separate status column
 * with values scheduled/waiting/in_progress/completed/cancelled. We
 * deliberately leave status alone here. ended_at = now() is the
 * lightweight signal the consult is over from the doctor's
 * perspective; ops will transition the booking to COMPLETED (which
 * fires M4's earning trigger) via /ops/bookings. Decoupling lets the
 * doctor wrap a consult without needing ops-level write privileges.
 */
export async function POST(req: NextRequest) {
  const session = await getCurrentDoctorSession();
  if (!session) {
    return NextResponse.json(
      { error: "Not signed in. Refresh /doctor and try again." },
      { status: 401 },
    );
  }

  let body: { session_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const sessionId = body.session_id;
  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json(
      { error: "session_id is required." },
      { status: 400 },
    );
  }

  const { data: sessionRow, error: sessionErr } = await supabaseAdmin
    .from("consultation_sessions")
    .select("id, doctor_id, ended_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionErr) {
    console.error("[doctor-mark-attended] session lookup failed:", sessionErr);
    return NextResponse.json(
      { error: "Could not mark consult attended." },
      { status: 500 },
    );
  }
  if (!sessionRow) {
    return NextResponse.json(
      { error: "Session not found." },
      { status: 400 },
    );
  }
  if (sessionRow.doctor_id !== session.doctor_id) {
    return NextResponse.json(
      { error: "This session belongs to a different doctor." },
      { status: 403 },
    );
  }

  if (sessionRow.ended_at) {
    return NextResponse.json({
      ok: true,
      ended_at: sessionRow.ended_at,
      already_attended: true,
    });
  }

  // M032 / Q8 gate: refuse to write ended_at unless a prescriptions
  // row exists for this session with BOTH chief_complaint AND
  // provisional_diagnosis populated (non-empty after trim). The
  // LobbyPanel disables the button on this same flag client-side,
  // but server enforcement is the load-bearing check — a client
  // could bypass via curl.
  const { data: rxRows } = await supabaseAdmin
    .from("prescriptions")
    .select("chief_complaint, provisional_diagnosis")
    .eq("session_id", sessionId);
  const gateOpen = (rxRows ?? []).some((r: {
    chief_complaint: string | null;
    provisional_diagnosis: string | null;
  }) => {
    const cc = (r.chief_complaint ?? "").trim();
    const pd = (r.provisional_diagnosis ?? "").trim();
    return cc !== "" && pd !== "";
  });
  if (!gateOpen) {
    return NextResponse.json(
      {
        error:
          "Save or send a prescription with chief complaint and diagnosis before marking attended.",
      },
      { status: 400 },
    );
  }

  // M032: write attendance_status + audit columns alongside ended_at.
  // attendance_status is the formal two-state Q2 signal; ended_at
  // stays as the existing "doctor closed the session" timestamp
  // (kept for backwards compatibility with PR #22's patient-side hook
  // that watches it for the post-consult screen).
  const nowIso = new Date().toISOString();
  const { data: updateRows, error: updateErr } = await supabaseAdmin
    .from("consultation_sessions")
    .update({
      ended_at: nowIso,
      attendance_status: "attended",
      attendance_marked_at: nowIso,
      attendance_marked_by: session.doctor_id,
    })
    .eq("id", sessionId)
    .is("ended_at", null)
    .select("ended_at");
  if (updateErr) {
    console.error("[doctor-mark-attended] update failed:", updateErr);
    return NextResponse.json(
      { error: "Could not mark consult attended." },
      { status: 500 },
    );
  }

  let endedAt: string;
  if (updateRows && updateRows.length > 0) {
    endedAt = (updateRows[0] as { ended_at: string }).ended_at;
  } else {
    const { data: refetchRow } = await supabaseAdmin
      .from("consultation_sessions")
      .select("ended_at")
      .eq("id", sessionId)
      .maybeSingle();
    endedAt =
      (refetchRow as { ended_at: string | null } | null)?.ended_at ?? nowIso;
  }

  console.log("[doctor-mark-attended] success", {
    doctor_id: session.doctor_id,
    session_id: sessionId,
    ended_at: endedAt,
  });
  return NextResponse.json({ ok: true, ended_at: endedAt });
}
