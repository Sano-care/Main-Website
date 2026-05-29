import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getCurrentDoctorSession } from "@/app/doctor/_lib/getCurrentDoctor";

export const runtime = "nodejs";

/**
 * POST /api/doctor/admit-patient
 *
 * The Sanocare-native admit click on the doctor's Patient Ready card
 * (Task #43). Writes consultation_sessions.doctor_admitted_at = now()
 * exactly once per session — the patient-side state machine watches
 * for this flip via useSessionAdmitState and transitions out of the
 * Sanocare waiting room into the Daily mount flow.
 *
 * Body: { session_id: string }   — the consultation_sessions UUID
 *
 * Returns:
 *   200 { ok: true, doctor_admitted_at: string }
 *     - The current admit timestamp. If we wrote, it's the new now();
 *       if a prior admit had already landed (idempotent re-click,
 *       second tab, refresh), it's the existing value.
 *   400 { error }   — bad body / unknown session_id
 *   401 { error }   — no doctor session cookie
 *   403 { error }   — session belongs to a different doctor
 *   500 { error }   — db issue
 *
 * Idempotency: the UPDATE runs `... WHERE id = $1 AND
 * doctor_admitted_at IS NULL`. A second click (from a second tab,
 * page refresh, etc.) updates 0 rows but returns 200 with the
 * existing timestamp — the caller treats both as success. Future
 * hardening (parked per founder's note) would add a row-level
 * BEFORE UPDATE trigger to prevent overwrites at the DB layer too.
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

  // Load the session row to verify ownership before any write. We could
  // fold ownership into the UPDATE WHERE clause and rely on row-count,
  // but that loses the ability to distinguish "wrong doctor" from
  // "already admitted" in the response — and a 403 for the wrong-doctor
  // case is actually useful for ops triage.
  const { data: sessionRow, error: sessionErr } = await supabaseAdmin
    .from("consultation_sessions")
    .select("id, doctor_id, status, doctor_admitted_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionErr) {
    console.error("[doctor-admit-patient] session lookup failed:", sessionErr);
    return NextResponse.json(
      { error: "Could not admit patient. Please try again." },
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

  // Idempotent admit — only writes if not already set.
  // If a prior admit already landed (the UI is racing two tabs, or the
  // patient was admitted on a previous visit), the UPDATE matches 0
  // rows and we return the existing timestamp.
  if (sessionRow.doctor_admitted_at) {
    return NextResponse.json({
      ok: true,
      doctor_admitted_at: sessionRow.doctor_admitted_at,
      already_admitted: true,
    });
  }

  const nowIso = new Date().toISOString();
  const { data: updateRows, error: updateErr } = await supabaseAdmin
    .from("consultation_sessions")
    .update({ doctor_admitted_at: nowIso })
    .eq("id", sessionId)
    .is("doctor_admitted_at", null) // belt + braces; eq matches the lookup
    .select("doctor_admitted_at");
  if (updateErr) {
    console.error("[doctor-admit-patient] admit update failed:", updateErr);
    return NextResponse.json(
      { error: "Could not admit patient. Please try again." },
      { status: 500 },
    );
  }

  // updateRows is an array; 0 rows means the row was admitted between
  // our lookup and our UPDATE (raced) — read back the now-set value.
  let admittedAt: string;
  if (updateRows && updateRows.length > 0) {
    admittedAt = (updateRows[0] as { doctor_admitted_at: string })
      .doctor_admitted_at;
  } else {
    const { data: refetchRow } = await supabaseAdmin
      .from("consultation_sessions")
      .select("doctor_admitted_at")
      .eq("id", sessionId)
      .maybeSingle();
    admittedAt =
      (refetchRow as { doctor_admitted_at: string | null } | null)
        ?.doctor_admitted_at ?? nowIso;
  }

  console.log("[doctor-admit-patient] success", {
    doctor_id: session.doctor_id,
    session_id: sessionId,
    admitted_at: admittedAt,
  });

  return NextResponse.json({
    ok: true,
    doctor_admitted_at: admittedAt,
  });
}
