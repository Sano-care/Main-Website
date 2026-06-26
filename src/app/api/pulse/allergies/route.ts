import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { resolveMemberId } from "../_lib/memberScope";
import { asYmdDate, isAllergySeverity, isRecordStatus, isUuid } from "../_lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET    /api/pulse/allergies       — list the signed-in customer's allergies.
// POST   /api/pulse/allergies       — add a self-entered allergy.
// DELETE /api/pulse/allergies?id=   — remove one of the customer's OWN
//                                      patient-sourced allergies.
//
// allergies is RLS deny-all (0 policies); supabaseAdmin (service-role) bypasses
// RLS, so every query is HARD-scoped by customer_id. `source` is always
// server-set to 'patient'. member_id IDOR-guarded. Mirrors /api/pulse/conditions.

const SELECT =
  "id, member_id, label, severity, reaction, status, source, noted_at, notes, created_at, updated_at";

export async function GET(req: NextRequest) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const { data, error } = await supabaseAdmin
    .from("allergies")
    .select(SELECT)
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[pulse/allergies] GET failed:", error);
    return NextResponse.json({ error: "Could not load allergies." }, { status: 500 });
  }
  return NextResponse.json({ allergies: data ?? [] });
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

  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (label.length < 1) {
    return NextResponse.json({ error: "Please enter an allergy." }, { status: 400 });
  }
  if (label.length > 120) {
    return NextResponse.json({ error: "That's too long (max 120 characters)." }, { status: 400 });
  }

  // severity — optional, default 'unknown', must be in enum.
  let severity = "unknown";
  if (body.severity !== undefined && body.severity !== null && body.severity !== "") {
    if (!isAllergySeverity(body.severity)) {
      return NextResponse.json({ error: "Pick a valid severity." }, { status: 400 });
    }
    severity = body.severity;
  }

  // status — optional, default 'active', must be in enum.
  let status = "active";
  if (body.status !== undefined && body.status !== null && body.status !== "") {
    if (!isRecordStatus(body.status)) {
      return NextResponse.json({ error: "Pick a valid status." }, { status: 400 });
    }
    status = body.status;
  }

  let notedAt: string | null = null;
  if (body.noted_at !== undefined && body.noted_at !== null && body.noted_at !== "") {
    notedAt = asYmdDate(body.noted_at);
    if (!notedAt) {
      return NextResponse.json({ error: "Date must be in YYYY-MM-DD format." }, { status: 400 });
    }
  }

  const reaction =
    typeof body.reaction === "string" && body.reaction.trim() !== ""
      ? body.reaction.trim().slice(0, 200)
      : null;
  const notes =
    typeof body.notes === "string" && body.notes.trim() !== ""
      ? body.notes.trim().slice(0, 500)
      : null;

  const scope = await resolveMemberId(customer.id, body.member_id);
  if ("error" in scope) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const { data, error } = await supabaseAdmin
    .from("allergies")
    .insert({
      customer_id: customer.id,
      member_id: scope.memberId,
      label,
      severity,
      reaction,
      status,
      noted_at: notedAt,
      notes,
      source: "patient", // server-set; a client value is ignored
    })
    .select(SELECT)
    .single();

  if (error || !data) {
    console.error("[pulse/allergies] POST failed:", error);
    return NextResponse.json({ error: "Could not save the allergy." }, { status: 500 });
  }
  return NextResponse.json({ allergy: data }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const id = req.nextUrl.searchParams.get("id");
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("allergies")
    .delete()
    .eq("id", id)
    .eq("customer_id", customer.id)
    .eq("source", "patient")
    .select("id");

  if (error) {
    console.error("[pulse/allergies] DELETE failed:", error);
    return NextResponse.json({ error: "Could not remove the allergy." }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "Not found, or it isn't one you can remove." },
      { status: 404 },
    );
  }
  return NextResponse.json({ deleted: id });
}
