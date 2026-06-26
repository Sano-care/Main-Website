import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { istTodayYMD } from "../_lib/ist";
import { SCHEDULE_DEFAULTS, normaliseScheduledTimes } from "../_lib/medications";
import { MED_SELECT, createMedication } from "../_lib/createMedication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  // Single meds writer — shared with Aarogya's chat-set reminder so the row
  // shape + intake-log seeding never diverge between the two front doors.
  const result = await createMedication({
    customerId: customer.id,
    name,
    dose,
    frequencyLabel,
    timesPerDay,
    scheduledTimes,
    startDate,
    endDate,
    reason,
    source: "manual",
  });

  if (result.error || !result.medication) {
    return NextResponse.json(
      { error: "Could not add the medication." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { medication: result.medication, intake_count: result.intakeCount },
    { status: 201 },
  );
}
