import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireMedic } from "@/lib/auth/requireMedic";
import {
  GDA_TASK_KEYS,
  NO_HOUSEHOLD_WORK_NOTE,
  isVitalTaskKey,
  DATE_RE,
  todayInIST,
} from "@/lib/gda/shared";

export const runtime = "nodejs";

// GDA Phase 1 (M064) — GET /api/medic-app/gda/shift?date=YYYY-MM-DD
//
// The GDA's shift for the day (default today IST), cookie-auth via requireMedic.
// Mirrors the nurse DutyTab pattern (/api/medic-app/duty) but for the attendant
// surface: one shift, the patient/deployment context, the 15-task checklist with
// its current state, and the "no household work" line the Android client renders.
//
// Identity comes from the medic cookie — the gda_id is ALWAYS the cookied medic,
// never a request param. A nurse hitting this simply has no gda_shifts → null.

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: NextRequest) {
  const auth = await requireMedic(request);
  if (auth instanceof NextResponse) return auth;

  const dateParam = request.nextUrl.searchParams.get("date");
  const date = dateParam && DATE_RE.test(dateParam) ? dateParam : todayInIST();

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const { data: shift, error: shiftErr } = await supabase
    .from("gda_shifts")
    .select(
      "id, deployment_id, shift_date, shift_kind, status, clock_in_at, clock_out_at, payout_paise",
    )
    .eq("gda_id", auth.medic_id)
    .eq("shift_date", date)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (shiftErr) {
    console.error("[medic-app/gda/shift] shift lookup failed", shiftErr);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }

  if (!shift) {
    return NextResponse.json({
      date,
      shift: null,
      no_household_work: NO_HOUSEHOLD_WORK_NOTE,
    });
  }

  const [{ data: deployment }, { data: checklist }] = await Promise.all([
    supabase
      .from("gda_deployments")
      .select("id, patient_name, address, shift_pattern, customer_id")
      .eq("id", shift.deployment_id)
      .maybeSingle(),
    supabase
      .from("gda_shift_checklist")
      .select("task_key, value, done_at")
      .eq("shift_id", shift.id),
  ]);

  const checklistByKey = new Map<
    string,
    { value: string | null; done_at: string | null }
  >();
  for (const row of (checklist ?? []) as Array<{
    task_key: string;
    value: string | null;
    done_at: string | null;
  }>) {
    checklistByKey.set(row.task_key, {
      value: row.value,
      done_at: row.done_at,
    });
  }

  // The 15 tasks in founder order, with current state. No household tasks exist
  // in this list by design (D2 scope is clinical / personal care).
  const tasks = GDA_TASK_KEYS.map((key) => {
    const existing = checklistByKey.get(key);
    return {
      task_key: key,
      is_vital: isVitalTaskKey(key),
      value: existing?.value ?? null,
      done_at: existing?.done_at ?? null,
      done: !!existing?.done_at,
    };
  });

  return NextResponse.json({
    date,
    shift: {
      id: shift.id,
      shift_date: shift.shift_date,
      shift_kind: shift.shift_kind,
      status: shift.status,
      clock_in_at: shift.clock_in_at,
      clock_out_at: shift.clock_out_at,
    },
    deployment: deployment
      ? {
          patient_name: deployment.patient_name,
          address: deployment.address,
          shift_pattern: deployment.shift_pattern,
          has_customer_link: !!deployment.customer_id,
        }
      : null,
    tasks,
    no_household_work: NO_HOUSEHOLD_WORK_NOTE,
  });
}
