import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getCurrentDoctorSession } from "@/app/doctor/_lib/getCurrentDoctor";

export const runtime = "nodejs";

/**
 * GET /api/doctor/lobby-state
 *
 * Source of truth for the LobbyPanel UI inside DutyRoomEmbed. Returns
 * the current doctor's sessions partitioned into:
 *
 *   WAITING  = patient hit /c/[token] (joined_at recent) but doctor
 *              hasn't clicked Admit yet (doctor_admitted_at IS NULL),
 *              AND ended_at IS NULL.
 *   IN_CALL  = doctor admitted (doctor_admitted_at IS NOT NULL),
 *              ended_at IS NULL.
 *   ATTENDED = ended_at IS NOT NULL — filtered out; the panel hides
 *              attended consults.
 *
 * The polling cadence on the panel side is 3–5s (matches the per-
 * session useSessionAdmitState hook). One endpoint, two tabs.
 *
 * Returns:
 *   200 { waiting: SessionInfo[], in_call: SessionInfo[] }
 *   401 { error }
 *
 * SessionInfo shape — keys match the panel UI directly:
 *   {
 *     session_id, booking_code, joined_at, doctor_admitted_at,
 *     patient_name,        // customer.full_name → bookings.patient_name → null
 *     customer_code,       // SAN-C-NNNNN or null
 *     date_of_birth,       // age derived client-side
 *     gender,              // M/F/O/U or null
 *     specific_ailment,    // presenting complaint
 *   }
 *
 * 24h cutoff: WAITING tab filters joined_at > now() - 24h. Kills
 * legacy stale joined_at values from prior test runs (PR #22 QA bug
 * 1 carry-over). IN_CALL has no such cutoff — admittedAt is a fresh
 * action and stale rows can't drift there without a doctor click.
 */
export async function GET() {
  const session = await getCurrentDoctorSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
  const staleCutoffIso = new Date(Date.now() - STALE_AFTER_MS).toISOString();

  // Pull all the doctor's sessions that haven't been marked attended.
  // We grab both partitions in ONE query and partition client-side.
  const { data: sessionRows, error: sessionErr } = await supabaseAdmin
    .from("consultation_sessions")
    .select(
      "id, booking_id, doctor_admitted_at, ended_at, scheduled_at",
    )
    .eq("doctor_id", session.doctor_id)
    .is("ended_at", null)
    .order("scheduled_at", { ascending: true })
    .limit(50);
  if (sessionErr) {
    console.error("[doctor-lobby-state] session lookup failed:", sessionErr);
    return NextResponse.json(
      { error: "Could not load lobby state." },
      { status: 500 },
    );
  }
  const sessions = (sessionRows ?? []) as Array<{
    id: string;
    booking_id: string;
    doctor_admitted_at: string | null;
    ended_at: string | null;
    scheduled_at: string;
  }>;

  if (sessions.length === 0) {
    return NextResponse.json({ waiting: [], in_call: [] });
  }

  // Patient participant rows for joined_at + customer_id.
  const sessionIds = sessions.map((s) => s.id);
  const { data: partRows, error: partErr } = await supabaseAdmin
    .from("consultation_participants")
    .select("session_id, customer_id, joined_at")
    .in("session_id", sessionIds)
    .eq("role", "patient");
  if (partErr) {
    console.error(
      "[doctor-lobby-state] participants lookup failed:",
      partErr,
    );
    return NextResponse.json(
      { error: "Could not load lobby state." },
      { status: 500 },
    );
  }
  const partsBySession = new Map<
    string,
    { customer_id: string | null; joined_at: string | null }
  >();
  for (const p of partRows ?? []) {
    if (!partsBySession.has(p.session_id)) {
      partsBySession.set(p.session_id, {
        customer_id: p.customer_id,
        joined_at: p.joined_at,
      });
    }
  }

  // Customer bio.
  const customerIds = [...partsBySession.values()]
    .map((p) => p.customer_id)
    .filter((id): id is string => !!id);
  type CustomerRow = {
    id: string;
    full_name: string | null;
    customer_code: string | null;
    date_of_birth: string | null;
    gender: string | null;
  };
  const customersById = new Map<string, CustomerRow>();
  if (customerIds.length > 0) {
    const { data: customers } = await supabaseAdmin
      .from("customers")
      .select("id, full_name, customer_code, date_of_birth, gender")
      .in("id", customerIds);
    for (const c of (customers ?? []) as CustomerRow[]) {
      customersById.set(c.id, c);
    }
  }

  // Booking context — booking_code, specific_ailment, patient_name
  // (the latter is the fallback when customer_id is NULL).
  const bookingIds = sessions.map((s) => s.booking_id);
  type BookingRow = {
    id: string;
    booking_code: string | null;
    specific_ailment: string | null;
    patient_name: string | null;
  };
  const bookingsById = new Map<string, BookingRow>();
  if (bookingIds.length > 0) {
    const { data: bookings } = await supabaseAdmin
      .from("bookings")
      .select("id, booking_code, specific_ailment, patient_name")
      .in("id", bookingIds);
    for (const b of (bookings ?? []) as BookingRow[]) {
      bookingsById.set(b.id, b);
    }
  }

  // M032: Mark-Attended gate. Per founder Q8, the doctor cannot mark
  // a consult attended until a prescriptions row exists for the
  // session with BOTH chief_complaint AND provisional_diagnosis
  // populated (non-empty after trim). Compute the flag per session
  // here so the LobbyPanel's Mark Attended button can render
  // disabled+tooltip without an extra round-trip.
  //
  // No status filter — any version on the session with both fields
  // populated passes (drafts qualify; the doctor has clearly examined
  // the patient enough to know what's wrong).
  const gateOpenBySession = new Set<string>();
  if (sessionIds.length > 0) {
    const { data: rxRows } = await supabaseAdmin
      .from("prescriptions")
      .select("session_id, chief_complaint, provisional_diagnosis")
      .in("session_id", sessionIds);
    for (const r of (rxRows ?? []) as {
      session_id: string;
      chief_complaint: string | null;
      provisional_diagnosis: string | null;
    }[]) {
      const cc = (r.chief_complaint ?? "").trim();
      const pd = (r.provisional_diagnosis ?? "").trim();
      if (cc !== "" && pd !== "") {
        gateOpenBySession.add(r.session_id);
      }
    }
  }

  type SessionInfo = {
    session_id: string;
    booking_code: string | null;
    joined_at: string | null;
    doctor_admitted_at: string | null;
    patient_name: string | null;
    customer_code: string | null;
    date_of_birth: string | null;
    gender: string | null;
    specific_ailment: string | null;
    /** M032 / Q8: true iff a prescriptions row on this session has
     *  BOTH chief_complaint AND provisional_diagnosis non-empty.
     *  Drives the LobbyPanel "Mark Attended" button enabled state. */
    mark_attended_gate_open: boolean;
  };

  const waiting: SessionInfo[] = [];
  const inCall: SessionInfo[] = [];

  for (const s of sessions) {
    const part = partsBySession.get(s.id);
    const cust = part?.customer_id
      ? customersById.get(part.customer_id) ?? null
      : null;
    const bk = bookingsById.get(s.booking_id) ?? null;
    const info: SessionInfo = {
      session_id: s.id,
      booking_code: bk?.booking_code ?? null,
      joined_at: part?.joined_at ?? null,
      doctor_admitted_at: s.doctor_admitted_at,
      // PR #22 QA bug 2 fix carried forward: name fallback chain
      patient_name: cust?.full_name ?? bk?.patient_name ?? null,
      customer_code: cust?.customer_code ?? null,
      date_of_birth: cust?.date_of_birth ?? null,
      gender: cust?.gender ?? null,
      specific_ailment: bk?.specific_ailment ?? null,
      mark_attended_gate_open: gateOpenBySession.has(s.id),
    };

    // State derivation per the redirect brief:
    //   WAITING = joined_at IS NOT NULL && doctor_admitted_at IS NULL
    //             (and joined_at within 24h)
    //   IN_CALL = doctor_admitted_at IS NOT NULL
    //   ATTENDED = ended_at IS NOT NULL — already filtered by the
    //              SELECT's .is("ended_at", null)
    if (s.doctor_admitted_at) {
      inCall.push(info);
    } else if (
      info.joined_at &&
      info.joined_at > staleCutoffIso
    ) {
      waiting.push(info);
    }
    // else: scheduled but never joined, OR joined > 24h ago without
    // ever being admitted — both suppressed from the panel.
  }

  return NextResponse.json({ waiting, in_call: inCall });
}
