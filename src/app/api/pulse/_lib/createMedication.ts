// Canonical medication write surface — the ONE insert path for the
// `medications` table. Both the Pulse web app (POST /api/pulse/medications) and
// Aarogya's chat-set reminder (log_medication) write through this, so the row
// shape + intake-log seeding never drift between the two front doors.
//
// Pure DB seam (no HTTP, no identity resolution): callers validate + resolve the
// customer upstream, then hand fully-formed fields here.

import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { expandIntakeLog } from "./medications";

export const MED_SELECT =
  "id, name, dose, frequency_label, times_per_day, scheduled_times, start_date, end_date, reason, source, source_rx_id, imported_needs_review, refill_warning_threshold_days, supply_qty, supply_updated_at, created_at";

/**
 * Allowed `medications.source` values — MUST mirror the `medications_source_check`
 * CHECK constraint (see migration 20260627034703). Any source written by a
 * caller has to be in this set or the insert is rejected at the DB. Keeping the
 * list here lets a unit test catch code↔constraint drift (the bug behind that
 * migration: #112 wrote 'aarogya_whatsapp' while the constraint allowed only
 * 'manual'/'rx_import', and the mocked tests never hit the real constraint).
 */
export const ALLOWED_MEDICATION_SOURCES = [
  "manual", // Pulse web app
  "rx_import", // doctor Rx → Pulse import
  "aarogya_whatsapp", // Aarogya chat-set reminder (#112)
] as const;

export type MedicationSource = (typeof ALLOWED_MEDICATION_SOURCES)[number];

/** The source the Aarogya chat-set reminder writes (referenced by the executor
 *  and the drift guard, so the written value and the allow-list can't diverge). */
export const AAROGYA_MEDICATION_SOURCE: MedicationSource = "aarogya_whatsapp";

export interface CreateMedicationInput {
  customerId: string;
  name: string;
  dose: string;
  frequencyLabel: string;
  timesPerDay: number;
  /** Already normalised to "HH:MM"[] (IST) by the caller. */
  scheduledTimes: string[];
  startDate: string; // YYYY-MM-DD (IST)
  endDate: string | null;
  reason: string | null;
  source: string; // "manual" (Pulse) | "aarogya_whatsapp" (chat)
}

export interface CreateMedicationResult {
  medication: Record<string, unknown> | null;
  intakeCount: number;
  error: string | null;
}

/**
 * Insert a medication row, then fan its schedule out into pending
 * medication_intake_log rows (best-effort — a log failure never loses the med).
 */
export async function createMedication(
  input: CreateMedicationInput,
): Promise<CreateMedicationResult> {
  const { data: med, error: insertErr } = await supabaseAdmin
    .from("medications")
    .insert({
      customer_id: input.customerId,
      name: input.name,
      dose: input.dose,
      frequency_label: input.frequencyLabel,
      times_per_day: input.timesPerDay,
      scheduled_times: input.scheduledTimes,
      start_date: input.startDate,
      end_date: input.endDate,
      reason: input.reason,
      source: input.source,
    })
    .select(MED_SELECT)
    .single();

  if (insertErr || !med) {
    console.error("[createMedication] insert failed:", insertErr);
    return { medication: null, intakeCount: 0, error: "insert_failed" };
  }

  const rows = expandIntakeLog({
    medicationId: med.id as string,
    scheduledTimes: input.scheduledTimes,
    startDate: input.startDate,
    endDate: input.endDate,
  });
  let intakeCount = 0;
  if (rows.length > 0) {
    const { error: logErr } = await supabaseAdmin
      .from("medication_intake_log")
      .insert(rows);
    if (logErr) {
      console.error("[createMedication] intake-log seed failed:", logErr);
    } else {
      intakeCount = rows.length;
    }
  }

  return { medication: med, intakeCount, error: null };
}

export interface ActiveMedicationRef {
  id: string;
  name: string;
}

/**
 * Find an ACTIVE medication (end_date NULL or ≥ today) for this customer whose
 * name matches case-insensitively. Used by the chat path to update an existing
 * reminder rather than duplicating it.
 */
export async function findActiveMedicationByName(
  customerId: string,
  name: string,
  todayYmd: string,
): Promise<ActiveMedicationRef | null> {
  const { data, error } = await supabaseAdmin
    .from("medications")
    .select("id, name")
    .eq("customer_id", customerId)
    .ilike("name", name)
    .or(`end_date.is.null,end_date.gte.${todayYmd}`)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[findActiveMedicationByName] read failed:", error.message);
    return null;
  }
  return (data as ActiveMedicationRef | null) ?? null;
}

/**
 * Update an existing medication's schedule in place (dedup-on-name path). The
 * #107 cron reads `scheduled_times` directly, so refreshing it here is enough
 * for the new reminder times to take effect.
 */
export async function updateMedicationSchedule(
  medicationId: string,
  patch: {
    scheduledTimes: string[];
    timesPerDay: number;
    frequencyLabel: string;
    dose: string;
  },
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("medications")
    .update({
      scheduled_times: patch.scheduledTimes,
      times_per_day: patch.timesPerDay,
      frequency_label: patch.frequencyLabel,
      dose: patch.dose,
    })
    .eq("id", medicationId);
  if (error) {
    console.error("[updateMedicationSchedule] update failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

/** Human frequency label from a dose count, e.g. 1→"Daily", 2→"Twice daily". */
export function frequencyLabelForCount(timesPerDay: number): string {
  switch (timesPerDay) {
    case 1:
      return "Daily";
    case 2:
      return "Twice daily";
    case 3:
      return "Three times daily";
    case 4:
      return "Four times daily";
    default:
      return `${timesPerDay} times daily`;
  }
}
