import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { validateInsert } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FM_SELECT =
  "id, customer_id, name, relation, relation_other, dob, gender, notes, created_at, updated_at";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PATCH  /api/pulse/family-members/[id]  — full overwrite (treats every field as required).
// DELETE /api/pulse/family-members/[id]  — hard delete. Linked bookings keep
//                                          their patient_name snapshot
//                                          (bookings.member_id flips to NULL
//                                          via ON DELETE SET NULL).
//
// IMPORTANT: PATCH requires the FULL member shape (same as POST) — we re-use
// `validateInsert` so the CHECK constraint stays honoured. In particular,
// when `relation` changes from 'other' to something else, the request body
// MUST set `relation_other` to null (or omit it / empty string — the
// validator normalises). When `relation` changes TO 'other', the body MUST
// supply a non-empty `relation_other`. Either rule slipping past the API
// layer trips the DB CHECK and fails loudly — never silent corruption.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validated = validateInsert(body);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  // updated_at bumped on PATCH (no DB-side trigger for it; see brief patch
  // open item — future micro-migration if it bites).
  const { data, error } = await supabaseAdmin
    .from("family_members")
    .update({
      ...validated.row,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("customer_id", customer.id) // belt-and-suspenders: API-layer ownership check
    .select(FM_SELECT)
    .single();

  if (error) {
    // PGRST116 = "No rows found" from PostgREST when the .eq filter
    // excludes the row. We map that to 404 so the client can show
    // "Member no longer exists" instead of a vague 500.
    if (error.code === "PGRST116") {
      return NextResponse.json(
        { error: "Family member not found." },
        { status: 404 },
      );
    }
    console.error("[pulse/family-members/:id] PATCH failed:", error);
    return NextResponse.json(
      { error: "Could not update the family member." },
      { status: 500 },
    );
  }

  return NextResponse.json({ member: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  // Bookings linked to this member keep their patient_name snapshot. The
  // FK `bookings.member_id REFERENCES family_members(id) ON DELETE SET NULL`
  // means past bookings simply "look like Self bookings" after delete —
  // we don't lose the booking row, we just lose the live linkage.
  const { error, count } = await supabaseAdmin
    .from("family_members")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("customer_id", customer.id);

  if (error) {
    console.error("[pulse/family-members/:id] DELETE failed:", error);
    return NextResponse.json(
      { error: "Could not delete the family member." },
      { status: 500 },
    );
  }

  if (count === 0) {
    return NextResponse.json(
      { error: "Family member not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
