import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import {
  asFiniteNumber,
  asIsoTimestamp,
  isUuid,
  isVitalKind,
} from "../../_lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH  /api/pulse/vitals/:id  — edit one of the caller's own readings.
// DELETE /api/pulse/vitals/:id  — HARD delete (vital_readings has no
//                                 archived_at column; M035 is delete-only).
//
// Ownership is enforced by scoping every mutation with
// `.eq("customer_id", customer.id)` so a guessed id belonging to another
// customer affects zero rows and returns 404. DELETE additionally scopes to
// `source='manual'` (R2b): a patient may remove only their own self-entered
// readings, never a clinician-captured one (source='device' from a home visit).

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid reading id." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if ("kind" in body) {
    if (!isVitalKind(body.kind)) {
      return NextResponse.json({ error: "Unknown vital kind." }, { status: 400 });
    }
    patch.kind = body.kind;
  }
  if ("value_numeric" in body) {
    const n = asFiniteNumber(body.value_numeric);
    if (n === null) {
      return NextResponse.json(
        { error: "value_numeric must be a number." },
        { status: 400 },
      );
    }
    patch.value_numeric = n;
  }
  if ("value_secondary" in body) {
    patch.value_secondary =
      body.value_secondary == null ? null : asFiniteNumber(body.value_secondary);
  }
  if ("taken_at" in body) {
    const iso = asIsoTimestamp(body.taken_at);
    if (!iso) {
      return NextResponse.json(
        { error: "taken_at must be a valid timestamp." },
        { status: 400 },
      );
    }
    patch.taken_at = iso;
  }
  if ("context_note" in body) {
    patch.context_note =
      typeof body.context_note === "string" && body.context_note.trim() !== ""
        ? body.context_note.trim().slice(0, 500)
        : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "No editable fields supplied." },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("vital_readings")
    .update(patch)
    .eq("id", id)
    .eq("customer_id", customer.id)
    .select(
      "id, kind, value_numeric, value_secondary, unit, taken_at, context_note, source, created_at",
    )
    .maybeSingle();

  if (error) {
    console.error("[pulse/vitals/:id] PATCH failed:", error);
    return NextResponse.json(
      { error: "Could not update the reading." },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Reading not found." }, { status: 404 });
  }

  return NextResponse.json({ reading: data });
}

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid reading id." }, { status: 400 });
  }

  // HARD delete — no archived_at column exists on vital_readings. Scoped to the
  // caller AND source='manual', so a guessed id, another customer's row, or a
  // clinician-captured (device) reading all affect zero rows → 404.
  const { data, error } = await supabaseAdmin
    .from("vital_readings")
    .delete()
    .eq("id", id)
    .eq("customer_id", customer.id)
    .eq("source", "manual")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[pulse/vitals/:id] DELETE failed:", error);
    return NextResponse.json(
      { error: "Could not delete the reading." },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Reading not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}
