import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import {
  asIsoTimestamp,
  isIntakeState,
  isUuid,
} from "../../../_lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

const INTAKE_SELECT =
  "id, medication_id, scheduled_at, taken_at, state, notes, created_at";

/**
 * Confirm the medication belongs to the signed-in customer. Returns the
 * medication id on success or a ready 401/404/400 response.
 */
async function requireOwnedMedication(
  req: NextRequest,
  medicationId: string,
): Promise<{ ok: true } | { response: NextResponse }> {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return { response: auth.response };

  if (!isUuid(medicationId)) {
    return {
      response: NextResponse.json(
        { error: "Invalid medication id." },
        { status: 400 },
      ),
    };
  }

  const { data, error } = await supabaseAdmin
    .from("medications")
    .select("id")
    .eq("id", medicationId)
    .eq("customer_id", auth.customer.id)
    .maybeSingle();

  if (error) {
    console.error("[pulse/medications/:id/intake] ownership check failed:", error);
    return {
      response: NextResponse.json(
        { error: "Could not load the medication." },
        { status: 500 },
      ),
    };
  }
  if (!data) {
    return {
      response: NextResponse.json(
        { error: "Medication not found." },
        { status: 404 },
      ),
    };
  }
  return { ok: true };
}

/**
 * POST /api/pulse/medications/:id/intake
 * Body: { scheduled_at, state, notes? }
 *
 * Marks the dose at `scheduled_at` taken/skipped/missed/pending. Upserts on
 * (medication_id, scheduled_at): updates the seeded pending row if present,
 * else inserts (covers ad-hoc / out-of-schedule doses). taken_at is stamped
 * server-side when state='taken', cleared otherwise.
 */
export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const owned = await requireOwnedMedication(req, id);
  if ("response" in owned) return owned.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const scheduledAt = asIsoTimestamp(body.scheduled_at);
  if (!scheduledAt) {
    return NextResponse.json(
      { error: "scheduled_at is required and must be a valid timestamp." },
      { status: 400 },
    );
  }
  if (!isIntakeState(body.state)) {
    return NextResponse.json(
      { error: "state must be pending, taken, skipped or missed." },
      { status: 400 },
    );
  }
  const notes =
    typeof body.notes === "string" && body.notes.trim() !== ""
      ? body.notes.trim().slice(0, 300)
      : null;
  const takenAt = body.state === "taken" ? new Date().toISOString() : null;

  // Find the seeded row for this exact scheduled slot.
  const { data: existing, error: findErr } = await supabaseAdmin
    .from("medication_intake_log")
    .select("id")
    .eq("medication_id", id)
    .eq("scheduled_at", scheduledAt)
    .maybeSingle();
  if (findErr) {
    console.error("[pulse/medications/:id/intake] lookup failed:", findErr);
    return NextResponse.json(
      { error: "Could not record the dose." },
      { status: 500 },
    );
  }

  if (existing?.id) {
    const { data, error } = await supabaseAdmin
      .from("medication_intake_log")
      .update({ state: body.state, taken_at: takenAt, notes })
      .eq("id", existing.id)
      .select(INTAKE_SELECT)
      .single();
    if (error || !data) {
      console.error("[pulse/medications/:id/intake] update failed:", error);
      return NextResponse.json(
        { error: "Could not record the dose." },
        { status: 500 },
      );
    }
    return NextResponse.json({ intake: data });
  }

  const { data, error } = await supabaseAdmin
    .from("medication_intake_log")
    .insert({
      medication_id: id,
      scheduled_at: scheduledAt,
      state: body.state,
      taken_at: takenAt,
      notes,
    })
    .select(INTAKE_SELECT)
    .single();
  if (error || !data) {
    console.error("[pulse/medications/:id/intake] insert failed:", error);
    return NextResponse.json(
      { error: "Could not record the dose." },
      { status: 500 },
    );
  }
  return NextResponse.json({ intake: data }, { status: 201 });
}

/**
 * GET /api/pulse/medications/:id/intake?from=&to=
 * Ascending intake rows for the medication in the optional window.
 */
export async function GET(req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const owned = await requireOwnedMedication(req, id);
  if ("response" in owned) return owned.response;

  const sp = req.nextUrl.searchParams;
  let query = supabaseAdmin
    .from("medication_intake_log")
    .select(INTAKE_SELECT)
    .eq("medication_id", id)
    .order("scheduled_at", { ascending: true });

  const from = sp.get("from");
  const to = sp.get("to");
  if (from) {
    const iso = asIsoTimestamp(from);
    if (iso) query = query.gte("scheduled_at", iso);
  }
  if (to) {
    const iso = asIsoTimestamp(to);
    if (iso) query = query.lte("scheduled_at", iso);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[pulse/medications/:id/intake] GET failed:", error);
    return NextResponse.json(
      { error: "Could not load intake log." },
      { status: 500 },
    );
  }

  return NextResponse.json({ intake: data ?? [] });
}
