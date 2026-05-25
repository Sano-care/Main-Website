import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getCurrentDoctor } from "./getCurrentDoctor";

/**
 * A teleconsult / vc-home-visit session waiting on this doctor's Duty
 * Room. Returned by getDoctorWaitingQueue(). C2-V ships read-only — the
 * doctor sees the queue + opens their Daily Duty Room; ops marks the
 * booking COMPLETED after the consult (which posts the M4 earning via
 * the trg_bookings_doctor_earnings trigger).
 */
export type DoctorWaitingSession = {
  id: string;
  booking_id: string;
  modality: "teleconsultation" | "vc_home_visit";
  status: "scheduled" | "waiting" | "in_progress";
  scheduled_at: string;
  patient_name: string | null;
  patient_clicked_link_at: string | null;
  teleconsult_consent: boolean | null;
};

/**
 * Centralized accessors for doctor-side data. Every accessor here scopes
 * by the session's doctor_id (via getCurrentDoctor()), never by a
 * caller-supplied id. This is the A1 enforcement boundary in C1: there
 * is no DB-level RLS for the doctor role, so the only way for a doctor
 * page to fetch ledger / profile data is through these functions — and
 * these functions only ever return the current session's data.
 *
 * Doctor pages MUST NOT query `doctors` or `doctor_ledger_entries`
 * directly. Add a new accessor here if a new data shape is needed.
 */

export type DoctorLedgerEntry = {
  id: string;
  entry_type:
    | "revenue_share"
    | "commission"
    | "daily_wage"
    | "overtime"
    | "payout"
    | "adjustment"
    | "reversal";
  amount_paise: number;
  entry_date: string;
  description: string | null;
  booking_id: string | null;
  attendance_id: string | null;
  reverses_entry_id: string | null;
  created_at: string;
};

export type DoctorLedgerEntryWithBalance = DoctorLedgerEntry & {
  running_balance_paise: number;
};

/**
 * Fetch the current doctor's ledger entries, oldest-first. The caller
 * typically walks this to compute running balances; for a newest-first
 * UI render, see getDoctorLedger() below.
 *
 * Limit 500 matches /ops/doctors/[id] — keeps the page bounded; if a
 * doctor ever exceeds this we'll paginate (not in C1's scope).
 *
 * Errors THROW (no silent empty-array fallback). A transient Supabase
 * failure surfacing as an apparent "₹0 ledger" would be misleading and
 * dangerous — the doctor might think they've been wiped. Throwing lets
 * Next.js render the route's error boundary so the doctor sees an
 * unambiguous "something went wrong, refresh / contact ops" surface
 * instead of false zero figures.
 */
export const getDoctorLedgerOldestFirst = cache(async (): Promise<DoctorLedgerEntry[]> => {
  const doctor = await getCurrentDoctor();
  const { data, error } = await supabaseAdmin
    .from("doctor_ledger_entries")
    .select(
      "id, entry_type, amount_paise, entry_date, description, booking_id, attendance_id, reverses_entry_id, created_at",
    )
    .eq("doctor_id", doctor.id)
    .order("entry_date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) {
    console.error("[getDoctorLedgerOldestFirst] supabase error:", error);
    throw new Error(
      `Could not load ledger for doctor ${doctor.doctor_code}: ${error.message}`,
    );
  }
  return (data as DoctorLedgerEntry[] | null) ?? [];
});

/**
 * Convenience: returns the ledger split into two views, both derived from
 * the same oldest-first fetch.
 *   - oldestFirst  → pass to computeDoctorFigures()
 *   - newestFirst  → render the table (with running_balance_paise
 *                    pre-computed via a forward walk)
 *
 * One DB round-trip; two render-ready slices.
 */
export const getDoctorLedger = cache(async (): Promise<{
  oldestFirst: DoctorLedgerEntry[];
  newestFirst: DoctorLedgerEntryWithBalance[];
}> => {
  const oldestFirst = await getDoctorLedgerOldestFirst();
  let runningBalance = 0;
  const oldestToNewestWithBalance: DoctorLedgerEntryWithBalance[] = oldestFirst.map((e) => {
    runningBalance += e.amount_paise;
    return { ...e, running_balance_paise: runningBalance };
  });
  const newestFirst = [...oldestToNewestWithBalance].reverse();
  return { oldestFirst, newestFirst };
});

/**
 * Fetch the current doctor's Duty Room queue — consultation_sessions
 * with status in (scheduled, waiting, in_progress), oldest first.
 *
 * C2-V doesn't subscribe to Daily webhooks yet (that's C3-V), so
 * sessions stay at 'scheduled' the whole time and the queue is
 * essentially "upcoming teleconsults for this doctor". The
 * patient_clicked_link_at column surfaces whether the patient has
 * tapped their WhatsApp link yet — a useful "they're about to knock"
 * signal even without webhook-driven presence.
 *
 * Limit 50 keeps the home page bounded; if a doctor ever has more
 * than 50 upcoming consults, the oldest 50 show — we'll paginate
 * later (not in C2's scope).
 *
 * Errors THROW (no silent empty-array fallback) — same posture as
 * getDoctorLedger after the C1 review.
 */
export const getDoctorWaitingQueue = cache(
  async (): Promise<DoctorWaitingSession[]> => {
    const doctor = await getCurrentDoctor();

    // Two-step lookup mirroring the patient join page — explicit join
    // shape over Supabase's nested-select, so failure modes are clear.
    const { data: sessions, error: sessionsErr } = await supabaseAdmin
      .from("consultation_sessions")
      .select(
        "id, booking_id, modality, status, scheduled_at, teleconsult_consent",
      )
      .eq("doctor_id", doctor.id)
      .in("status", ["scheduled", "waiting", "in_progress"])
      .order("scheduled_at", { ascending: true })
      .limit(50);
    if (sessionsErr) {
      console.error("[getDoctorWaitingQueue] sessions lookup failed:", sessionsErr);
      throw new Error(
        `Could not load Duty Room queue for ${doctor.doctor_code}: ${sessionsErr.message}`,
      );
    }
    const rows = sessions ?? [];
    if (rows.length === 0) return [];

    // Resolve participants (patient role) for the listed sessions in
    // a single batched query. Doctor / medic participant rows are
    // ignored — only the patient name + joined_at matter for the
    // doctor queue render.
    const sessionIds = rows.map((s) => s.id);
    const { data: parts, error: partsErr } = await supabaseAdmin
      .from("consultation_participants")
      .select("session_id, customer_id, joined_at")
      .in("session_id", sessionIds)
      .eq("role", "patient");
    if (partsErr) {
      console.error("[getDoctorWaitingQueue] participants lookup failed:", partsErr);
      throw new Error(
        `Could not load Duty Room queue (participants) for ${doctor.doctor_code}: ${partsErr.message}`,
      );
    }
    const partsBySession = new Map<
      string,
      { customer_id: string | null; joined_at: string | null }
    >();
    for (const p of parts ?? []) {
      // First patient row per session wins (we always insert one).
      if (!partsBySession.has(p.session_id)) {
        partsBySession.set(p.session_id, {
          customer_id: p.customer_id,
          joined_at: p.joined_at,
        });
      }
    }

    // Resolve customer names in one batched query as well.
    const customerIds = [...partsBySession.values()]
      .map((p) => p.customer_id)
      .filter((id): id is string => !!id);
    const namesById = new Map<string, string>();
    if (customerIds.length > 0) {
      const { data: customers } = await supabaseAdmin
        .from("customers")
        .select("id, full_name")
        .in("id", customerIds);
      for (const c of customers ?? []) {
        namesById.set(c.id, c.full_name);
      }
    }

    return rows.map((s) => {
      const part = partsBySession.get(s.id);
      return {
        id: s.id,
        booking_id: s.booking_id,
        modality: s.modality as DoctorWaitingSession["modality"],
        status: s.status as DoctorWaitingSession["status"],
        scheduled_at: s.scheduled_at,
        patient_name: part?.customer_id
          ? namesById.get(part.customer_id) ?? null
          : null,
        patient_clicked_link_at: part?.joined_at ?? null,
        teleconsult_consent: s.teleconsult_consent,
      };
    });
  },
);
