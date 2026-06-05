import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import {
  asFiniteNumber,
  asIsoTimestamp,
  isVitalKind,
  parsePositiveInt,
} from "../_lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/pulse/vitals   — list the signed-in customer's readings.
// POST /api/pulse/vitals   — log one reading.
//
// All rows are customer-scoped via requirePulseCustomer; an unauthenticated
// request gets a 401 before any DB access.

/**
 * GET /api/pulse/vitals?kind=&from=&to=&limit=&offset=
 *
 * 200 { readings, limit, offset }
 * 401 unauthenticated
 */
export async function GET(req: NextRequest) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind");
  const from = sp.get("from");
  const to = sp.get("to");
  const limit = parsePositiveInt(sp.get("limit"), 50, 200);
  const offset = parsePositiveInt(sp.get("offset"), 0, 100_000);

  if (kind && !isVitalKind(kind)) {
    return NextResponse.json({ error: "Unknown vital kind." }, { status: 400 });
  }

  let query = supabaseAdmin
    .from("vital_readings")
    .select(
      "id, kind, value_numeric, value_secondary, unit, taken_at, context_note, source, created_at",
    )
    .eq("customer_id", customer.id)
    .order("taken_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (kind) query = query.eq("kind", kind);
  if (from) {
    const iso = asIsoTimestamp(from);
    if (iso) query = query.gte("taken_at", iso);
  }
  if (to) {
    const iso = asIsoTimestamp(to);
    if (iso) query = query.lte("taken_at", iso);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[pulse/vitals] GET failed:", error);
    return NextResponse.json(
      { error: "Could not load readings." },
      { status: 500 },
    );
  }

  return NextResponse.json({ readings: data ?? [], limit, offset });
}

/**
 * POST /api/pulse/vitals
 * Body: { kind, value_numeric, value_secondary?, taken_at, context_note? }
 *
 * 201 { reading }
 * 400 invalid body · 401 unauthenticated
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

  if (!isVitalKind(body.kind)) {
    return NextResponse.json(
      { error: "kind must be a known vital type." },
      { status: 400 },
    );
  }
  const valueNumeric = asFiniteNumber(body.value_numeric);
  if (valueNumeric === null) {
    return NextResponse.json(
      { error: "value_numeric is required and must be a number." },
      { status: 400 },
    );
  }
  const takenAt = asIsoTimestamp(body.taken_at);
  if (!takenAt) {
    return NextResponse.json(
      { error: "taken_at is required and must be a valid timestamp." },
      { status: 400 },
    );
  }
  const valueSecondary =
    body.value_secondary == null ? null : asFiniteNumber(body.value_secondary);
  const contextNote =
    typeof body.context_note === "string" && body.context_note.trim() !== ""
      ? body.context_note.trim().slice(0, 500)
      : null;

  const { data, error } = await supabaseAdmin
    .from("vital_readings")
    .insert({
      customer_id: customer.id,
      kind: body.kind,
      value_numeric: valueNumeric,
      value_secondary: valueSecondary,
      taken_at: takenAt,
      context_note: contextNote,
      source: "manual",
    })
    .select(
      "id, kind, value_numeric, value_secondary, unit, taken_at, context_note, source, created_at",
    )
    .single();

  if (error || !data) {
    console.error("[pulse/vitals] POST failed:", error);
    return NextResponse.json(
      { error: "Could not save the reading." },
      { status: 500 },
    );
  }

  return NextResponse.json({ reading: data }, { status: 201 });
}
