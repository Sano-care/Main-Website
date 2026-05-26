import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getCurrentDoctorSession } from "@/app/doctor/_lib/getCurrentDoctor";
import { mintMeetingToken } from "@/lib/daily/client";
import { DailyApiError, DailyAuthError } from "@/lib/daily/auth";

export const runtime = "nodejs";

/**
 * POST /api/doctor/duty-room/start
 *
 * Mints an owner-privileged Daily meeting token for the signed-in
 * doctor's Duty Room. Used by the /doctor home's "Open Duty Room"
 * action — clicking it triggers this endpoint, receives the room URL +
 * token, and embeds the Daily Prebuilt iframe.
 *
 * Self-checking endpoint (per C1 discipline — every /api/doctor/*
 * route validates its own session, doesn't trust layouts). Reads the
 * `sanocare_doctor_session` cookie via getCurrentDoctorSession(),
 * which verifies the C1 custom JWT.
 *
 * Returns:
 *   200 { ok: true, room_url, meeting_token, meeting_token_exp }
 *   401 { error }   — no/invalid/expired doctor session cookie
 *   400 { error }   — doctor's Duty Room not provisioned yet
 *   500 { error }   — env / supabase issue
 *   502 { error }   — Daily REST API error
 *
 * Token policy (C2-V Step 0 review):
 *   - is_owner: true (admit/deny knockers, mute others, screen share)
 *   - exp:      8 hours from now (matches the C1 doctor session TTL —
 *               one token per working shift)
 */
export async function POST() {
  const session = await getCurrentDoctorSession();
  if (!session) {
    return NextResponse.json(
      { error: "Not signed in. Refresh /doctor and try again." },
      { status: 401 },
    );
  }

  // Re-fetch the doctor row to get fresh duty_room_join_url +
  // duty_room_provider_ref + full_name. We don't trust the session
  // payload for these — the session only carries doctor_id + phone.
  type DoctorRow = {
    id: string;
    full_name: string;
    duty_room_join_url: string | null;
    duty_room_provider_ref: string | null;
    is_active: boolean;
  };
  const { data: docRow, error: docErr } = await supabaseAdmin
    .from("doctors")
    .select("id, full_name, duty_room_join_url, duty_room_provider_ref, is_active")
    .eq("id", session.doctor_id)
    .maybeSingle();
  if (docErr) {
    console.error("[doctor-duty-room-start] doctor lookup failed:", docErr);
    return NextResponse.json({ error: "Could not load your account." }, { status: 500 });
  }
  const doctor = (docRow as DoctorRow | null) ?? null;
  if (!doctor) {
    // Doctor was deleted/deactivated since the cookie was minted — the
    // /doctor layout would normally redirect them out at next page
    // load. Here, fail closed.
    return NextResponse.json(
      { error: "Your account is no longer active. Sign out and contact ops." },
      { status: 401 },
    );
  }
  if (!doctor.is_active) {
    return NextResponse.json(
      { error: "Your account is inactive. Contact ops." },
      { status: 401 },
    );
  }
  if (!doctor.duty_room_join_url || !doctor.duty_room_provider_ref) {
    return NextResponse.json(
      {
        error:
          "Your Duty Room isn't set up yet. Ask ops to provision it on /ops/doctors before starting a consult.",
      },
      { status: 400 },
    );
  }

  // 8-hour owner token — one token per shift; doctor uses it to admit
  // patients from the knock lobby, mute participants, share screen.
  const DOCTOR_TOKEN_TTL_SECONDS = 8 * 60 * 60;
  const exp = Math.floor(Date.now() / 1000) + DOCTOR_TOKEN_TTL_SECONDS;

  let meetingToken: string;
  try {
    const result = await mintMeetingToken({
      room_name: doctor.duty_room_provider_ref,
      is_owner: true,
      exp,
      user_name: doctor.full_name,
      // Skip Daily's prejoin UI for the doctor. They're not joining
      // someone else's call — they're going on duty in their own
      // room. The previous fix tried to use the iframe-level
      // `showPrejoinUI: false` option, but that property doesn't
      // exist in DailyCallOptions (daily-js 0.90.0) — it was silently
      // ignored because the factory was cast to `any`. The
      // token-level `enable_prejoin_ui` is the actually-honoured knob.
      // Daily's internal ~10s prejoin-inactivity timeout (which fired
      // a spurious 'left-meeting' on the production v1 deploy) is
      // also sidestepped here because the doctor lands in-call
      // immediately, never sitting in prejoin.
      enable_prejoin_ui: false,
    });
    meetingToken = result.token;
  } catch (err) {
    if (err instanceof DailyAuthError) {
      console.error("[doctor-duty-room-start] Daily auth/env missing:", err);
      return NextResponse.json(
        {
          error:
            "Video service is not configured. Contact ops — the Daily API key isn't set on Netlify.",
        },
        { status: 500 },
      );
    }
    if (err instanceof DailyApiError) {
      console.error("[doctor-duty-room-start] Daily API error:", err);
      return NextResponse.json(
        { error: "Could not start your Duty Room. Try again in a moment." },
        { status: 502 },
      );
    }
    console.error("[doctor-duty-room-start] Daily mint failed:", err);
    return NextResponse.json(
      { error: "Could not start your Duty Room." },
      { status: 500 },
    );
  }

  console.log("[doctor-duty-room-start] success", {
    doctor_id: doctor.id,
    room_name: doctor.duty_room_provider_ref,
  });

  return NextResponse.json({
    ok: true,
    room_url: doctor.duty_room_join_url,
    meeting_token: meetingToken,
    meeting_token_exp: exp,
  });
}
