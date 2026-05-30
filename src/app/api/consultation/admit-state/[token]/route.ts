import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isValidConsultJoinTokenFormat } from "@/lib/consult/tokens";

export const runtime = "nodejs";

/**
 * GET /api/consultation/admit-state/[token]
 *
 * Polling backstop for the patient's useSessionAdmitState hook on
 * /c/[token]. Returns the current { joinedAt, admittedAt, endedAt }
 * for the session this token resolves to. Called every 5s by
 * PatientJoinClient to drive transitions:
 *
 *   admittedAt: null → non-null  →  mount Daily
 *   admittedAt: non-null → null  →  unmount Daily, re-show waiting
 *                                    (doctor clicked Send to Waiting)
 *   endedAt:    null → non-null  →  unmount Daily, show post-consult
 *                                    (doctor clicked Mark Attended)
 *
 * Token IS the auth — same posture as POST /api/consultation/join/
 * [token] and the /c/[token] page render. No Supabase auth session.
 *
 * Returns:
 *   200 { joinedAt, admittedAt, endedAt: string | null }
 *   400 { error }   — bad token format / not found
 *   410 { error }   — token expired
 *
 * Read-only. The route never writes.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (!isValidConsultJoinTokenFormat(token)) {
    return NextResponse.json(
      { error: "Invalid token format." },
      { status: 400 },
    );
  }

  const { data: participant, error: participantErr } = await supabaseAdmin
    .from("consultation_participants")
    .select("id, role, session_id, joined_at, join_token_expires_at")
    .eq("join_token", token)
    .maybeSingle();
  if (participantErr) {
    console.error(
      "[consult-admit-state] participant lookup failed:",
      participantErr,
    );
    return NextResponse.json(
      { error: "Could not load state." },
      { status: 500 },
    );
  }
  if (!participant || participant.role !== "patient") {
    return NextResponse.json(
      { error: "Link not recognised." },
      { status: 400 },
    );
  }
  if (
    participant.join_token_expires_at &&
    new Date(participant.join_token_expires_at) < new Date()
  ) {
    return NextResponse.json(
      { error: "This link has expired." },
      { status: 410 },
    );
  }

  const { data: sessionRow, error: sessionErr } = await supabaseAdmin
    .from("consultation_sessions")
    .select("doctor_admitted_at, ended_at")
    .eq("id", participant.session_id)
    .maybeSingle();
  if (sessionErr) {
    console.error(
      "[consult-admit-state] session lookup failed:",
      sessionErr,
    );
    return NextResponse.json(
      { error: "Could not load state." },
      { status: 500 },
    );
  }

  const sess = sessionRow as {
    doctor_admitted_at: string | null;
    ended_at: string | null;
  } | null;

  return NextResponse.json({
    joinedAt:
      (participant as { joined_at: string | null }).joined_at ?? null,
    admittedAt: sess?.doctor_admitted_at ?? null,
    endedAt: sess?.ended_at ?? null,
  });
}
