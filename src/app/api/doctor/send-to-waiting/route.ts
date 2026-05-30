import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getCurrentDoctorSession } from "@/app/doctor/_lib/getCurrentDoctor";

export const runtime = "nodejs";

/**
 * POST /api/doctor/send-to-waiting
 *
 * Clinic-lobby control (PR #22 redirect, Task #43): send an in-call
 * patient back to the Sanocare waiting room without ending the
 * consult. Real-world use: doctor needs to step out briefly / take
 * vitals / consult a colleague / let the patient compose a question.
 *
 * Writes consultation_sessions.doctor_admitted_at = NULL on the
 * session, IFF ended_at is still NULL (i.e., the consult hasn't been
 * formally marked attended). Once the timestamp clears, the patient's
 * useSessionAdmitState hook sees admittedAt go non-null → null and
 * the PatientJoinClient state machine unmounts the Daily iframe and
 * re-renders the Sanocare waiting screen with brief-hold copy.
 *
 * Body: { session_id: string }
 *
 * Returns:
 *   200 { ok: true, already_in_waiting?: true }
 *     - If the session was admitted, we cleared it.
 *     - If ended_at is set, we refuse with 400 (the consult is over).
 *     - If admittedAt was already null (idempotent re-click), 200
 *       with already_in_waiting=true.
 *   400 { error }   — bad body / ended session / no such session
 *   401 { error }   — no doctor session cookie
 *   403 { error }   — session belongs to a different doctor
 *   500 { error }   — db issue
 *
 * Idempotency: the UPDATE filters by id + doctor_admitted_at IS NOT
 * NULL + ended_at IS NULL. Re-click is a 0-row update; we return 200
 * with already_in_waiting=true so the caller doesn't show an error.
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
    .select("id, doctor_id, doctor_admitted_at, ended_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionErr) {
    console.error("[doctor-send-to-waiting] session lookup failed:", sessionErr);
    return NextResponse.json(
      { error: "Could not send patient to waiting room." },
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
    return NextResponse.json(
      { error: "This consult has already been marked attended." },
      { status: 400 },
    );
  }

  // Already in waiting? Idempotent no-op.
  if (!sessionRow.doctor_admitted_at) {
    return NextResponse.json({ ok: true, already_in_waiting: true });
  }

  const { error: updateErr } = await supabaseAdmin
    .from("consultation_sessions")
    .update({ doctor_admitted_at: null })
    .eq("id", sessionId)
    .is("ended_at", null);
  if (updateErr) {
    console.error("[doctor-send-to-waiting] clear failed:", updateErr);
    return NextResponse.json(
      { error: "Could not send patient to waiting room." },
      { status: 500 },
    );
  }

  console.log("[doctor-send-to-waiting] success", {
    doctor_id: session.doctor_id,
    session_id: sessionId,
  });
  return NextResponse.json({ ok: true });
}
