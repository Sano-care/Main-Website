import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  DOCTOR_SESSION_COOKIE_NAME,
  verifyDoctorToken,
  type VerifiedDoctorToken,
} from "@/lib/otp/token";
import { supabaseAdmin } from "@/lib/supabase-server";

/**
 * The full doctor record visible to a logged-in doctor on their own /doctor
 * pages. Sourced via the service-role client because there is no
 * Postgres-level "doctor" role in C1 — see migration 020's header for the
 * rationale. Per-doctor scoping is enforced here: the lookup id always
 * comes from the verified session token, never from a request parameter.
 */
export type CurrentDoctor = {
  id: string;
  doctor_code: string;
  full_name: string;
  qualification: string | null;
  registration_no: string | null;
  phone: string | null;
  email: string | null;
  doctor_type: "freelancer" | "salaried";
  revenue_share_pct: number | null;
  daily_wage_paise: number | null;
  commission_per_visit_paise: number | null;
  overtime_hourly_paise: number | null;
  pay_notes: string | null;
  duty_room_join_url: string | null;
  is_active: boolean;
};

/**
 * Read + verify the doctor session cookie. Does NOT redirect — returns
 * null on any failure so API routes can choose 401 over 302. Use this in
 * /api/doctor/* route handlers when you need to self-check the session.
 */
export async function getCurrentDoctorSession(): Promise<VerifiedDoctorToken | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(DOCTOR_SESSION_COOKIE_NAME)?.value;
  return verifyDoctorToken(token);
}

/**
 * Resolve the currently signed-in doctor, or redirect to /doctor/login.
 * Wrapped in React `cache()` so multiple callers in the same request share
 * a single Supabase round-trip — same pattern as getCurrentOpsUser. Used
 * by the (shell) layout and by the home page; the home page calls it
 * directly and also calls getDoctorLedger() which calls it again under
 * the cache wrapper.
 *
 * Three redirect paths:
 *   - missing / invalid / expired cookie → /doctor/login
 *   - cookie is valid but the doctor row was deactivated since mint →
 *     /doctor/login?reason=inactive (the login form surfaces the reason)
 *   - cookie is valid but the doctor row was deleted → same as inactive
 */
export const getCurrentDoctor = cache(async (): Promise<CurrentDoctor> => {
  const session = await getCurrentDoctorSession();
  if (!session) redirect("/doctor/login");

  const { data, error } = await supabaseAdmin
    .from("doctors")
    .select(
      "id, doctor_code, full_name, qualification, registration_no, phone, email, doctor_type, revenue_share_pct, daily_wage_paise, commission_per_visit_paise, overtime_hourly_paise, pay_notes, duty_room_join_url, is_active",
    )
    .eq("id", session.doctor_id)
    .maybeSingle();

  if (error) {
    console.error("[getCurrentDoctor] supabase error:", error);
    redirect("/doctor/login");
  }
  if (!data) {
    // Row gone — treat as logged out.
    redirect("/doctor/login?reason=inactive");
  }
  if (!data.is_active) {
    redirect("/doctor/login?reason=inactive");
  }

  return data as CurrentDoctor;
});
