import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isValidConsultJoinTokenFormat } from "@/lib/consult/tokens";

export const runtime = "nodejs";

/**
 * POST /api/consultation/join/[token]
 *
 * Records the patient's teleconsultation consent, stamps the
 * participant's joined_at (first tap only), and returns the doctor's
 * PMI URL with the patient's display name appended (so Zoom pre-fills
 * the participant name in the waiting room).
 *
 * Body: { consent: boolean }   — must be true; false rejects with 400
 *
 * Returns:
 *   200 { ok: true, redirect_url }
 *   400 { error }   — bad token / consent not true / session state wrong
 *   410 { error }   — token expired / session completed / cancelled
 *   500 { error }   — env / supabase issue
 *
 * Uses the service-role client throughout — the patient has no session
 * cookie. The token IS the auth, exactly as on /c/[token]'s page render.
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
  // are explicit (each lookup either returns a row or we 404).
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
    .select("id, status, zoom_join_url, doctor_id, teleconsult_consent")
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

  // Resolve the PMI URL: prefer the session snapshot, fall back to the
  // doctor's current duty_room_join_url. Same fallback as the page.
  let pmiUrl = session.zoom_join_url;
  let patientNameForZoom: string | null = null;
  if (!pmiUrl) {
    const { data: doctor } = await supabaseAdmin
      .from("doctors")
      .select("duty_room_join_url")
      .eq("id", session.doctor_id)
      .maybeSingle();
    pmiUrl = doctor?.duty_room_join_url ?? null;
  }
  if (!pmiUrl) {
    return NextResponse.json(
      {
        error:
          "Your doctor's room isn't set up yet. Please call ops on +91-97119 77782.",
      },
      { status: 400 },
    );
  }

  // Resolve the patient's display name so Zoom shows "Anjali Sharma"
  // not "Guest" in the waiting room.
  if (participant.customer_id) {
    const { data: customer } = await supabaseAdmin
      .from("customers")
      .select("full_name")
      .eq("id", participant.customer_id)
      .maybeSingle();
    patientNameForZoom = customer?.full_name ?? null;
  }

  // Write consent (idempotent — the column is set to true; later taps
  // of the same link won't overwrite the consent timestamp once set).
  // Also stamp joined_at on first tap.
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
      // Non-fatal — the consent is the load-bearing record. Log and
      // proceed so the patient still gets to Zoom.
      console.warn(
        "[consult-join] participant joined_at update failed (non-fatal):",
        partUpdateErr,
      );
    }
  }

  // Append the patient's name to the Zoom URL so the waiting-room
  // entry doesn't render as "Guest". Zoom's PMI URL accepts a `uname`
  // query string parameter on the join endpoint (zoom.us/j/<pmi>).
  const redirect_url = patientNameForZoom
    ? appendQuery(pmiUrl, "uname", patientNameForZoom)
    : pmiUrl;

  console.log("[consult-join] success", {
    token: token.slice(0, 8) + "…",
    session_id: session.id,
    doctor_id: session.doctor_id,
  });

  return NextResponse.json({ ok: true, redirect_url });
}

function appendQuery(url: string, key: string, value: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  } catch {
    // Malformed PMI URL — fall back to returning it untouched. The
    // patient still gets to Zoom; they just get to type their name
    // manually in the waiting room.
    return url;
  }
}
