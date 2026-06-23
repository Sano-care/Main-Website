import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  requireOpsAdminApi,
  requireOpsUserApi,
} from "@/app/ops/_lib/requireOpsAdmin";
import {
  DATE_RE,
  UUID_RE,
  SHIFT_PATTERNS,
  type ShiftPattern,
} from "@/lib/gda/shared";

export const runtime = "nodejs";

// GDA Phase 1 (M064) — /api/ops/gda/deployments
//
//   GET   list deployments (newest first; ?status= filter). Admin + agent read.
//   POST  create a deployment (admin only). A GDA engaged for a patient over a
//         date range under service_category=homecare (D6) — deployment_type is
//         always 'attendant'. end_date is optional (D4: single-shift / open-ended).
//         medication_consent captured here (D2a) — when consent=true we stamp
//         medication_consent_at = now().

function rupeesToPaiseOrNull(v: unknown): number | null | "invalid" {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return Math.round(n * 100);
}

export async function GET(request: NextRequest) {
  const gate = await requireOpsUserApi();
  if (gate instanceof NextResponse) return gate;

  const status = request.nextUrl.searchParams.get("status");
  let query = supabaseAdmin
    .from("gda_deployments")
    .select(
      "id, patient_name, address, customer_id, booking_id, shift_pattern, start_date, end_date, rate_per_shift_paise, medication_consent_at, status, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (status && ["active", "paused", "ended"].includes(status)) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[ops/gda/deployments] list failed", error);
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }
  return NextResponse.json({ deployments: data ?? [] });
}

export async function POST(request: NextRequest) {
  const gate = await requireOpsAdminApi();
  if (gate instanceof NextResponse) return gate;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const patientName = String(body.patient_name ?? "").trim();
  if (patientName.length < 2 || patientName.length > 120) {
    return NextResponse.json(
      { error: "invalid_patient_name", detail: "2–120 characters." },
      { status: 400 },
    );
  }

  const address = String(body.address ?? "").trim();
  if (address.length < 4 || address.length > 500) {
    return NextResponse.json(
      { error: "invalid_address", detail: "4–500 characters." },
      { status: 400 },
    );
  }

  const shiftPattern = String(body.shift_pattern ?? "");
  if (!(SHIFT_PATTERNS as readonly string[]).includes(shiftPattern)) {
    return NextResponse.json(
      { error: "invalid_shift_pattern", detail: "12h or 24h." },
      { status: 400 },
    );
  }

  const startDate = String(body.start_date ?? "");
  if (!DATE_RE.test(startDate)) {
    return NextResponse.json(
      { error: "invalid_start_date", detail: "YYYY-MM-DD." },
      { status: 400 },
    );
  }

  let endDate: string | null = null;
  if (body.end_date != null && String(body.end_date).length > 0) {
    endDate = String(body.end_date);
    if (!DATE_RE.test(endDate)) {
      return NextResponse.json(
        { error: "invalid_end_date", detail: "YYYY-MM-DD." },
        { status: 400 },
      );
    }
    if (endDate < startDate) {
      return NextResponse.json(
        { error: "end_before_start" },
        { status: 400 },
      );
    }
  }

  const rate = rupeesToPaiseOrNull(body.rate_per_shift_rupees);
  if (rate === "invalid") {
    return NextResponse.json({ error: "invalid_rate" }, { status: 400 });
  }

  let customerId: string | null = null;
  if (body.customer_id != null && String(body.customer_id).length > 0) {
    customerId = String(body.customer_id);
    if (!UUID_RE.test(customerId)) {
      return NextResponse.json({ error: "invalid_customer_id" }, { status: 400 });
    }
  }

  let bookingId: string | null = null;
  if (body.booking_id != null && String(body.booking_id).length > 0) {
    bookingId = String(body.booking_id);
    if (!UUID_RE.test(bookingId)) {
      return NextResponse.json({ error: "invalid_booking_id" }, { status: 400 });
    }
  }

  // D2a — family medication consent. Stamp the time when ops records consent.
  const medicationConsentAt =
    body.medication_consent === true ? new Date().toISOString() : null;

  const { data: created, error: insertErr } = await supabaseAdmin
    .from("gda_deployments")
    .insert({
      patient_name: patientName,
      address,
      customer_id: customerId,
      booking_id: bookingId,
      shift_pattern: shiftPattern as ShiftPattern,
      start_date: startDate,
      end_date: endDate,
      rate_per_shift_paise: rate,
      medication_consent_at: medicationConsentAt,
      created_by: gate.id,
      // deployment_type defaults to 'attendant'; status defaults to 'active'.
    })
    .select("id")
    .single();
  if (insertErr || !created) {
    console.error("[ops/gda/deployments] insert failed", insertErr);
    return NextResponse.json(
      { error: "insert_failed", detail: insertErr?.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ deployment_id: created.id }, { status: 201 });
}
