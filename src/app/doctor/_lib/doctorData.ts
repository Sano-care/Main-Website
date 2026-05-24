import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getCurrentDoctor } from "./getCurrentDoctor";

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
