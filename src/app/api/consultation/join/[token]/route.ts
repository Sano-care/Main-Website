import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isValidConsultJoinTokenFormat } from "@/lib/consult/tokens";
import { mintMeetingToken } from "@/lib/daily/client";
import { DailyApiError, DailyAuthError } from "@/lib/daily/auth";

export const runtime = "nodejs";

/**
 * POST /api/consultation/join/[token]
 *
 * Records the patient's teleconsultation consent, stamps the
 * participant's joined_at (first tap only), and returns a fresh Daily
 * meeting token + the room URL so the client can join the embedded
 * Daily Prebuilt call on /c/[token].
 *
 * Body: { consent: boolean }   — must be true; false rejects with 400
 *
 * Returns:
 *   200 { ok: true, room_url, meeting_token, meeting_token_exp,
 *         patient_name }
 *   400 { error }   — bad token / consent not true / session state wrong /
 *                     Duty Room not provisioned
 *   410 { error }   — token expired / session completed / cancelled
 *   500 { error }   — env / supabase / Daily issue
 *
 * Uses the service-role client throughout — the patient has no session
 * cookie. The token IS the auth, exactly as on /c/[token]'s page render.
 *
 * C2-V replaces C2's redirect-out flow: the response carries a
 * 90-minute non-owner Daily meeting token instead of a redirect URL.
 * The patient's client embeds Daily Prebuilt and joins with the token;
 * the doctor (with an owner token from /api/doctor/duty-room/start)
 * admits them from the knock lobby.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (!isValidConsultJoinTokenFormat(token)) {
    return NextResponse.json({ error: "Invalid token format." }, { status: 400 });
  }

  let body: { consent?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (body.consent !== true) {
    return NextResponse.json(
      {
        error:
          "Teleconsultation consent is required (per NMC Telemedicine Practice Guidelines 2020).",
      },
      { status: 400 },
    );
  }

  // Look up the participant + session in one chain. We deliberately
  // avoid Supabase's nested-select FK syntax here so the failure modes
  // are explicit (each lookup either returns a row or we surface a
  // typed error).
  const { data: participant, error: participantErr } = await supabaseAdmin
    .from("consultation_participants")
    .select("id, role, session_id, join_token_expires_at, joined_at, customer_id")
    .eq("join_token", token)
    .maybeSingle();
  if (participantErr) {
    console.error("[consult-join] participant lookup failed:", participantErr);
    return NextResponse.json({ error: "Could not start consultation." }, { status: 500 });
  }
  if (!participant || participant.role !== "patient") {
    return NextResponse.json({ error: "Link not recognised." }, { status: 400 });
  }

  // Expiry gate.
  if (
    participant.join_token_expires_at &&
    new Date(participant.join_token_expires_at) < new Date()
  ) {
    return NextResponse.json(
      { error: "This link has expired. Please contact ops for a fresh link." },
      { status: 410 },
    );
  }

  const { data: session, error: sessionErr } = await supabaseAdmin
    .from("consultation_sessions")
    .select("id, status, duty_room_url_snapshot, doctor_id, teleconsult_consent")
    .eq("id", participant.session_id)
    .maybeSingle();
  if (sessionErr || !session) {
    console.error("[consult-join] session lookup failed:", sessionErr);
    return NextResponse.json({ error: "Could not start consultation." }, { status: 500 });
  }
  if (session.status === "completed" || session.status === "cancelled") {
    return NextResponse.json(
      {
        error:
          session.status === "completed"
            ? "This consultation has ended."
            : "This consultation was cancelled.",
      },
      { status: 410 },
    );
  }

  // Resolve the Duty Room URL + provider ref (Daily room name).
  // Prefer the session snapshot for the URL — locked at session-create
  // so a later doctor edit doesn't retroactively re-point old sessions.
  // The provider ref (room name, needed for token minting) is always
  // current — Daily's API keys tokens to live room names, so a stale
  // snapshot name would 404 at mint time.
  let roomUrl = session.duty_room_url_snapshot as string | null;
  const { data: doctor } = await supabaseAdmin
    .from("doctors")
    .select("duty_room_join_url, duty_room_provider_ref, full_name")
    .eq("id", session.doctor_id)
    .maybeSingle();
  if (!roomUrl) {
    roomUrl = doctor?.duty_room_join_url ?? null;
  }
  const roomName = doctor?.duty_room_provider_ref ?? null;

  if (!roomUrl || !roomName) {
    return NextResponse.json(
      {
        error:
          "Your doctor's Duty Room isn't set up yet. Please call ops on +91-97119 77782.",
      },
      { status: 400 },
    );
  }

  // Resolve the patient's display name so the Daily participant list
  // shows e.g. "Anjali Sharma" instead of "Guest".
  let patientNameForDaily: string | null = null;
  if (participant.customer_id) {
    const { data: customer } = await supabaseAdmin
      .from("customers")
      .select("full_name")
      .eq("id", participant.customer_id)
      .maybeSingle();
    patientNameForDaily = customer?.full_name ?? null;
  }

  // Write consent + joined_at FIRST, then mint the token. If the mint
  // call fails (Daily down, env var missing), the consent record still
  // landed — the patient can re-tap their WhatsApp link and we'll just
  // mint a fresh token next time. If we minted before writing, a Daily
  // success + DB error would leave the patient with a usable token but
  // no consent record on file — wrong order for an NMC audit.
  const nowIso = new Date().toISOString();
  const sessionUpdate: Record<string, unknown> = {};
  if (session.teleconsult_consent !== true) {
    sessionUpdate.teleconsult_consent = true;
    sessionUpdate.teleconsult_consent_at = nowIso;
  }
  if (Object.keys(sessionUpdate).length > 0) {
    const { error: updateErr } = await supabaseAdmin
      .from("consultation_sessions")
      .update(sessionUpdate)
      .eq("id", session.id);
    if (updateErr) {
      console.error("[consult-join] session update failed:", updateErr);
      return NextResponse.json(
        { error: "Could not record consent. Please try again." },
        { status: 500 },
      );
    }
  }
  if (!participant.joined_at) {
    const { error: partUpdateErr } = await supabaseAdmin
      .from("consultation_participants")
      .update({ joined_at: nowIso })
      .eq("id", participant.id);
    if (partUpdateErr) {
      // Non-fatal — consent is the load-bearing record. Proceed.
      console.warn(
        "[consult-join] participant joined_at update failed (non-fatal):",
        partUpdateErr,
      );
    }
  }

  // Mint a 90-minute non-owner Daily meeting token. Long enough for a
  // delayed admit + a full consult; short enough that a leaked token
  // isn't long-lived. (TTL raised from 30 min after Step 0 review.)
  const PATIENT_TOKEN_TTL_SECONDS = 90 * 60;
  const exp = Math.floor(Date.now() / 1000) + PATIENT_TOKEN_TTL_SECONDS;

  let meetingToken: string;
  try {
    const result = await mintMeetingToken({
      room_name: roomName,
      is_owner: false,
      exp,
      user_name: patientNameForDaily ?? "Patient",
      enable_screenshare: false,
      start_audio_off: true,
    });
    meetingToken = result.token;
  } catch (err) {
    if (err instanceof DailyAuthError) {
      console.error("[consult-join] Daily auth/env missing:", err);
      return NextResponse.json(
        { error: "Video service is not configured. Please contact ops." },
        { status: 500 },
      );
    }
    if (err instanceof DailyApiError) {
      console.error("[consult-join] Daily API error:", err);
      return NextResponse.json(
        { error: "Could not start the call. Please try again or contact ops." },
        { status: 502 },
      );
    }
    console.error("[consult-join] Daily mint failed:", err);
    return NextResponse.json(
      { error: "Could not start the call. Please try again." },
      { status: 500 },
    );
  }

  console.log("[consult-join] success", {
    token: token.slice(0, 8) + "…",
    session_id: session.id,
    doctor_id: session.doctor_id,
    room_name: roomName,
  });

  return NextResponse.json({
    ok: true,
    room_url: roomUrl,
    meeting_token: meetingToken,
    meeting_token_exp: exp,
    patient_name: patientNameForDaily,
  });
}
