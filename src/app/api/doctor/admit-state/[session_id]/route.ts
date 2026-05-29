import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getCurrentDoctorSession } from "@/app/doctor/_lib/getCurrentDoctor";

export const runtime = "nodejs";

/**
 * GET /api/doctor/admit-state/[session_id]
 *
 * Polling backstop for the doctor's useSessionAdmitState hook. Returns
 * the current { joinedAt, admittedAt } for a session, scoped to the
 * signed-in doctor. Called every 5s by the Patient Ready card so the
 * card surfaces the live patient-joined signal even when realtime
 * postgres_changes is rejected by RLS (which it usually is — see the
 * hook's docstring).
 *
 * Returns:
 *   200 { joinedAt: string | null, admittedAt: string | null }
 *   401 { error }   — no doctor session cookie
 *   403 { error }   — session belongs to a different doctor
 *   404 { error }   — unknown session_id
 *
 * Read-only, no side effects. The 5s polling cadence (3 reads/min/
 * session) is well within Supabase's free-tier rate budget even with
 * a busy doctor running 20 consults a day.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ session_id: string }> },
) {
  const session = await getCurrentDoctorSession();
  if (!session) {
    return NextResponse.json(
      { error: "Not signed in." },
      { status: 401 },
    );
  }

  const { session_id: sessionId } = await params;
  if (!sessionId) {
    return NextResponse.json(
      { error: "session_id is required." },
      { status: 400 },
    );
  }

  // Two-query lookup — same posture as fetchParticipantByToken in
  // /c/[token]'s page. Keeps the failure modes explicit and the join
  // shape obvious.
  const { data: sessionRow, error: sessionErr } = await supabaseAdmin
    .from("consultation_sessions")
    .select("id, doctor_id, doctor_admitted_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionErr) {
    console.error("[doctor-admit-state] session lookup failed:", sessionErr);
    return NextResponse.json(
      { error: "Could not load session." },
      { status: 500 },
    );
  }
  if (!sessionRow) {
    return NextResponse.json(
      { error: "Session not found." },
      { status: 404 },
    );
  }
  if (sessionRow.doctor_id !== session.doctor_id) {
    return NextResponse.json(
      { error: "This session belongs to a different doctor." },
      { status: 403 },
    );
  }

  // joined_at lives on the patient participant row. There's exactly one
  // patient per session (M021 schema); take the most recent if a
  // weird state ever ships two.
  const { data: patientRow, error: patientErr } = await supabaseAdmin
    .from("consultation_participants")
    .select("joined_at")
    .eq("session_id", sessionId)
    .eq("role", "patient")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (patientErr) {
    console.error(
      "[doctor-admit-state] patient participant lookup failed:",
      patientErr,
    );
    // Non-fatal — return what we have. The doctor's queue will still
    // render; only the live wait-time counter is missing.
  }

  return NextResponse.json({
    joinedAt:
      (patientRow as { joined_at: string | null } | null)?.joined_at ?? null,
    admittedAt:
      (sessionRow as { doctor_admitted_at: string | null })
        .doctor_admitted_at ?? null,
  });
}
