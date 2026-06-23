// T65 Phase 1 — medic attendance route.
// Medic payroll — moved to DAY-LEVEL attendance (one row per medic per IST
// work_date) so the daily-wage accrual has a stable, de-duplicated anchor.
//
// GET  /api/medic-app/attendance → { open: row | null }   (today's open row)
// POST /api/medic-app/attendance → body { action: 'clock_in' | 'clock_out',
//                                         lat?: number, lng?: number }
//
// Day-level model (was: a fresh row per clock-in):
//   - clock_in: upsert by (medic_id, work_date). First clock-in of the day
//     inserts the day row (work_date + clock_in_at + is_present=true). A later
//     clock-in on a day already closed re-opens it (clears clock_out_at) and
//     keeps the original clock_in_at. UNIQUE(medic_id, work_date) makes the day
//     row singular — it's the double-post guard for the daily wage.
//   - clock_out: stamps clock_out_at on today's open row.
//
// The wage itself is posted by the trg_medic_attendance_earnings trigger — and
// ONLY once selfie_verified_at is set (the Aarogya selfie flow, or ops manually).
// A bare clock-in never posts a daily wage, by design. So clock_in returns a
// selfie prompt the Android client surfaces (deep-link to the Aarogya WA line).
//
// 401 if no medic cookie; 409 on state conflict; 400 on invalid action.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireMedic } from "@/lib/auth/requireMedic";

export const runtime = "nodejs";

// Canonical Aarogya / ops WhatsApp line (same number used across CTAs).
const AAROGYA_WA_NUMBER = "919711977782";
const SELFIE_PROMPT_TEXT =
  "Send today's attendance selfie here to verify your daily wage.";

function selfiePrompt() {
  return {
    message: SELFIE_PROMPT_TEXT,
    wa_url: `https://wa.me/${AAROGYA_WA_NUMBER}?text=${encodeURIComponent(
      "Attendance selfie",
    )}`,
  };
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Today's date in IST (UTC+05:30, no DST), as YYYY-MM-DD. */
function workDateIST(): string {
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const auth = await requireMedic(request);
  if (auth instanceof NextResponse) return auth;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  // Today's open row. Scoped to work_date so a forgotten prior-day clock-out
  // (a second open row) can't turn this into a multi-row error.
  const { data: open, error } = await supabase
    .from("medic_attendance")
    .select("*")
    .eq("medic_id", auth.medic_id)
    .eq("work_date", workDateIST())
    .is("clock_out_at", null)
    .maybeSingle();

  if (error) {
    console.error("[medic-app/attendance] GET lookup failed", error);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }

  return NextResponse.json({ open });
}

export async function POST(request: NextRequest) {
  const auth = await requireMedic(request);
  if (auth instanceof NextResponse) return auth;

  let body: { action?: string; lat?: number; lng?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const action = body.action;
  const lat = typeof body.lat === "number" ? body.lat : null;
  const lng = typeof body.lng === "number" ? body.lng : null;

  if (action !== "clock_in" && action !== "clock_out") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const workDate = workDateIST();

  if (action === "clock_in") {
    // Today's day row (if any). One row per (medic, work_date).
    const { data: today, error: lookupErr } = await supabase
      .from("medic_attendance")
      .select("id, clock_out_at")
      .eq("medic_id", auth.medic_id)
      .eq("work_date", workDate)
      .maybeSingle();
    if (lookupErr) {
      console.error("[medic-app/attendance] day-row lookup failed", lookupErr);
      return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
    }

    if (today) {
      if (today.clock_out_at === null) {
        // Already clocked in and still open.
        return NextResponse.json({ error: "already_clocked_in" }, { status: 409 });
      }
      // Day was closed earlier — re-open it (resume). Keep original clock_in_at.
      const { data: row, error: reopenErr } = await supabase
        .from("medic_attendance")
        .update({ clock_out_at: null })
        .eq("id", today.id)
        .select()
        .single();
      if (reopenErr || !row) {
        console.error("[medic-app/attendance] re-open failed", reopenErr);
        return NextResponse.json({ error: "clock_in_failed" }, { status: 500 });
      }
      return NextResponse.json({ open: row, selfie_prompt: selfiePrompt() });
    }

    // First clock-in of the day → insert the day row.
    const { data: row, error: insertErr } = await supabase
      .from("medic_attendance")
      .insert({
        medic_id: auth.medic_id,
        clock_in_at: new Date().toISOString(),
        clock_in_lat: lat,
        clock_in_lng: lng,
        work_date: workDate,
        is_present: true,
      })
      .select()
      .single();
    if (insertErr || !row) {
      console.error("[medic-app/attendance] clock-in insert failed", insertErr);
      return NextResponse.json({ error: "clock_in_failed" }, { status: 500 });
    }
    return NextResponse.json(
      { open: row, selfie_prompt: selfiePrompt() },
      { status: 201 },
    );
  }

  // action === "clock_out" — stamp today's open row.
  const { data: open, error: openErr } = await supabase
    .from("medic_attendance")
    .select("id")
    .eq("medic_id", auth.medic_id)
    .eq("work_date", workDate)
    .is("clock_out_at", null)
    .maybeSingle();
  if (openErr) {
    console.error("[medic-app/attendance] open-row lookup failed", openErr);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!open) {
    return NextResponse.json({ error: "not_clocked_in" }, { status: 409 });
  }

  const { data: row, error: updateErr } = await supabase
    .from("medic_attendance")
    .update({
      clock_out_at: new Date().toISOString(),
      clock_out_lat: lat,
      clock_out_lng: lng,
    })
    .eq("id", open.id)
    .select()
    .single();
  if (updateErr || !row) {
    console.error("[medic-app/attendance] clock-out update failed", updateErr);
    return NextResponse.json({ error: "clock_out_failed" }, { status: 500 });
  }

  return NextResponse.json({ open: null, last: row });
}
