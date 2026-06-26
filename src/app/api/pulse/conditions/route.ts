import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { resolveMemberId } from "../_lib/memberScope";
import { asYmdDate, isRecordStatus, isUuid } from "../_lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET    /api/pulse/conditions       — list the signed-in customer's conditions.
// POST   /api/pulse/conditions       — add a self-entered condition.
// DELETE /api/pulse/conditions?id=   — remove one of the customer's OWN
//                                       patient-sourced conditions.
//
// conditions is RLS deny-all (0 policies); supabaseAdmin (service-role) bypasses
// RLS, so every query is HARD-scoped by customer_id here. `source` is always
// server-set to 'patient' — never read from the client. member_id is IDOR-
// guarded. Mirrors the /api/pulse/vitals route shape.

const SELECT =
  "id, member_id, label, status, source, noted_at, notes, created_at, updated_at";

export async function GET(req: NextRequest) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const { data, error } = await supabaseAdmin
    .from("conditions")
    .select(SELECT)
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[pulse/conditions] GET failed:", error);
    return NextResponse.json({ error: "Could not load conditions." }, { status: 500 });
  }
  return NextResponse.json({ conditions: data ?? [] });
}

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

  // label — required, trimmed.
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (label.length < 1) {
    return NextResponse.json({ error: "Please enter a condition." }, { status: 400 });
  }
  if (label.length > 120) {
    return NextResponse.json({ error: "That's too long (max 120 characters)." }, { status: 400 });
  }

  // status — optional, default 'active', must be in enum.
  let status = "active";
  if (body.status !== undefined && body.status !== null && body.status !== "") {
    if (!isRecordStatus(body.status)) {
      return NextResponse.json({ error: "Pick a valid status." }, { status: 400 });
    }
    status = body.status;
  }

  // noted_at — optional ISO date.
  let notedAt: string | null = null;
  if (body.noted_at !== undefined && body.noted_at !== null && body.noted_at !== "") {
    notedAt = asYmdDate(body.noted_at);
    if (!notedAt) {
      return NextResponse.json({ error: "Date must be in YYYY-MM-DD format." }, { status: 400 });
    }
  }

  const notes =
    typeof body.notes === "string" && body.notes.trim() !== ""
      ? body.notes.trim().slice(0, 500)
      : null;

  // member_id — IDOR-guarded.
  const scope = await resolveMemberId(customer.id, body.member_id);
  if ("error" in scope) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const { data, error } = await supabaseAdmin
    .from("conditions")
    .insert({
      customer_id: customer.id, // session customer — never trusted from input
      member_id: scope.memberId,
      label,
      status,
      noted_at: notedAt,
      notes,
      source: "patient", // server-set; a client value is ignored
    })
    .select(SELECT)
    .single();

  if (error || !data) {
    console.error("[pulse/conditions] POST failed:", error);
    return NextResponse.json({ error: "Could not save the condition." }, { status: 500 });
  }
  return NextResponse.json({ condition: data }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const id = req.nextUrl.searchParams.get("id");
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  // Scope to customer_id AND source='patient' — a patient may only remove their
  // own self-entered rows, never a medic/doctor/import entry. .select() echoes
  // the deleted rows so we can 404 when nothing matched.
  const { data, error } = await supabaseAdmin
    .from("conditions")
    .delete()
    .eq("id", id)
    .eq("customer_id", customer.id)
    .eq("source", "patient")
    .select("id");

  if (error) {
    console.error("[pulse/conditions] DELETE failed:", error);
    return NextResponse.json({ error: "Could not remove the condition." }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "Not found, or it isn't one you can remove." },
      { status: 404 },
    );
  }
  return NextResponse.json({ deleted: id });
}
