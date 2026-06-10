import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { istTodayYMD } from "../_lib/ist";
import {
  SCHEDULE_DEFAULTS,
  expandIntakeLog,
  normaliseScheduledTimes,
} from "../_lib/medications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MED_SELECT =
  "id, name, dose, frequency_label, times_per_day, scheduled_times, start_date, end_date, reason, source, source_rx_id, imported_needs_review, refill_warning_threshold_days, supply_qty, supply_updated_at, created_at";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET  /api/pulse/medications?active=true — list meds.
// POST /api/pulse/medications              — add a manual med + seed 14 days
//                                            of pending intake-log rows.

/**
 * GET /api/pulse/medications?active=true
 * active=true → end_date IS NULL OR end_date >= today (IST).
 */
export async function GET(req: NextRequest) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const activeOnly = req.nextUrl.searchParams.get("active") === "true";

  let query = supabaseAdmin
    .from("medications")
    .select(MED_SELECT)
    .eq("customer_id", customer.id)
    .order("start_date", { ascending: false });

  if (activeOnly) {
    const today = istTodayYMD();
    query = query.or(`end_date.is.null,end_date.gte.${today}`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[pulse/medications] GET failed:", error);
    return NextResponse.json(
      { error: "Could not load medications." },
      { status: 500 },
    );
  }

  return NextResponse.json({ medications: data ?? [] });
}

/**
 * POST /api/pulse/medications
 * Body: { name, dose, frequency_label, times_per_day?, scheduled_times?,
 *         start_date?, end_date?, reason? }
 *
 * Inserts the medication (source='manual') then fans its schedule out into
 * 14 days of pending medication_intake_log rows.
 *
 * 201 { medication, intake_count }
 */
export async function POST(req: NextRequest) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const dose = typeof body.dose === "string" ? body.dose.trim() : "";
  const frequencyLabel =
    typeof body.frequency_label === "string" ? body.frequency_label.trim() : "";
  if (!name || !dose || !frequencyLabel) {
    return NextResponse.json(
      { error: "name, dose and frequency_label are required." },
      { status: 400 },
    );
  }

  // times_per_day: 0..6. Default 1.
  let timesPerDay = 1;
  if (body.times_per_day != null) {
    const n = Number(body.times_per_day);
    if (!Number.isInteger(n) || n < 0 || n > 6) {
      return NextResponse.json(
        { error: "times_per_day must be an integer 0–6." },
        { status: 400 },
      );
    }
    timesPerDay = n;
  }

  // scheduled_times: explicit array wins; else fall back to the canonical
  // defaults for the dose count.
  const explicitTimes = normaliseScheduledTimes(body.scheduled_times);
  const scheduledTimes =
    explicitTimes.length > 0
      ? explicitTimes
      : (SCHEDULE_DEFAULTS[timesPerDay] ?? []);

  const startDate =
    typeof body.start_date === "string" && YMD_RE.test(body.start_date)
      ? body.start_date
      : istTodayYMD();
  const endDate =
    typeof body.end_date === "string" && YMD_RE.test(body.end_date)
      ? body.end_date
      : null;
  const reason =
    typeof body.reason === "string" && body.reason.trim() !== ""
      ? body.reason.trim().slice(0, 300)
      : null;

  const { data: med, error: insertErr } = await supabaseAdmin
    .from("medications")
    .insert({
      customer_id: customer.id,
      name,
      dose,
      frequency_label: frequencyLabel,
      times_per_day: timesPerDay,
      scheduled_times: scheduledTimes,
      start_date: startDate,
      end_date: endDate,
      reason,
      source: "manual",
    })
    .select(MED_SELECT)
    .single();

  if (insertErr || !med) {
    console.error("[pulse/medications] POST insert failed:", insertErr);
    return NextResponse.json(
      { error: "Could not add the medication." },
      { status: 500 },
    );
  }

  // Seed the intake log. Best-effort: a log failure shouldn't lose the med,
  // but we surface the count so the client knows whether to refetch.
  const rows = expandIntakeLog({
    medicationId: med.id as string,
    scheduledTimes,
    startDate,
    endDate,
  });
  let intakeCount = 0;
  if (rows.length > 0) {
    const { error: logErr } = await supabaseAdmin
      .from("medication_intake_log")
      .insert(rows);
    if (logErr) {
      console.error("[pulse/medications] intake-log seed failed:", logErr);
    } else {
      intakeCount = rows.length;
    }
  }

  return NextResponse.json(
    { medication: med, intake_count: intakeCount },
    { status: 201 },
  );
}
