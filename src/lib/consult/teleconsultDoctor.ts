import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// PB4a — resolve THE teleconsultation doctor for native/bearer bookings, which
// have no ops-side doctor picker. consultation_sessions.doctor_id is NOT NULL,
// so the native verify path must pin a doctor at create time.
//
// Resolution priority (founder decision):
//   1. TELECONSULT_DOCTOR_ID env override — if set, that doctor is used
//      (must be active). An explicitly-set-but-missing/inactive id fails closed
//      (returns null) rather than silently routing to a different doctor.
//   2. Otherwise the single active doctor that has a Duty Room URL (today
//      SAN-D-00001). No is_teleconsult_default column exists and none is added.
//
// Returns null when nothing resolves; the caller decides how to degrade (the
// verify route still records the paid booking and lets ops attach a session).

export interface TeleconsultDoctor {
  id: string;
  full_name: string;
  duty_room_join_url: string | null;
}

export async function resolveTeleconsultDoctor(
  supabase: SupabaseClient,
): Promise<TeleconsultDoctor | null> {
  const override = process.env.TELECONSULT_DOCTOR_ID?.trim();

  if (override) {
    const { data } = await supabase
      .from("doctors")
      .select("id, full_name, duty_room_join_url, is_active")
      .eq("id", override)
      .maybeSingle();
    if (!data || !data.is_active) return null;
    return {
      id: data.id as string,
      full_name: data.full_name as string,
      duty_room_join_url: (data.duty_room_join_url as string | null) ?? null,
    };
  }

  // Single active doctor with a provisioned Duty Room. `.limit(1)` keeps this
  // deterministic if a second active doctor is ever added before the env
  // override is set (oldest wins).
  const { data } = await supabase
    .from("doctors")
    .select("id, full_name, duty_room_join_url")
    .eq("is_active", true)
    .not("duty_room_join_url", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id as string,
    full_name: data.full_name as string,
    duty_room_join_url: (data.duty_room_join_url as string | null) ?? null,
  };
}
