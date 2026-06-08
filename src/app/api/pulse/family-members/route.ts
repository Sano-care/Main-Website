import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import {
  ALL_GENDERS,
  ALL_RELATIONS,
  type Gender,
  type Relation,
} from "@/lib/family-members/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/pulse/family-members     — list this customer's members.
// POST /api/pulse/family-members     — create a new member (capped 8 by DB trigger).
//
// Per T64_BRIEF_PATCH.md divergence 1: no RLS on the table; ownership is
// enforced HERE via `requirePulseCustomer(req)` + an explicit
// `customer_id = customer.id` clause / payload on every query. Mirrors the
// medications / vitals routes.

const FM_SELECT =
  "id, customer_id, name, relation, relation_other, dob, gender, notes, created_at, updated_at";

/** ISO-date `YYYY-MM-DD`. Anything more elaborate (`T`, time zones) is rejected. */
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const { data, error } = await supabaseAdmin
    .from("family_members")
    .select(FM_SELECT)
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[pulse/family-members] GET failed:", error);
    return NextResponse.json(
      { error: "Could not load family members." },
      { status: 500 },
    );
  }

  return NextResponse.json({ members: data ?? [] });
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

  const validated = validateInsert(body);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("family_members")
    .insert({
      customer_id: customer.id,
      ...validated.row,
    })
    .select(FM_SELECT)
    .single();

  if (error) {
    // The 8-member-cap trigger raises a check_violation. Surface that
    // distinctly so the client can render a clear UX message instead of a
    // generic 500.
    const message = String(error.message ?? "");
    if (message.includes("Family member cap reached")) {
      return NextResponse.json(
        {
          error:
            "You've added the maximum of 8 family members. Delete one to add another.",
        },
        { status: 409 },
      );
    }
    console.error("[pulse/family-members] POST insert failed:", error);
    return NextResponse.json(
      { error: "Could not add the family member." },
      { status: 500 },
    );
  }

  return NextResponse.json({ member: data }, { status: 201 });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ValidatedInsert {
  row: {
    name: string;
    relation: Relation;
    relation_other: string | null;
    dob: string | null;
    gender: Gender | null;
    notes: string | null;
  };
}

/**
 * Parse + validate the POST body. Returns `{ row }` on success, or
 * `{ error }` with a user-facing message. The DB CHECK constraints are
 * the ultimate enforcer; this layer just gives nicer error messages and
 * avoids round-tripping obvious garbage.
 *
 * Critical CHECK to mirror: `relation_other` MUST be non-empty iff
 * `relation === 'other'`. Enforced here AND by the DB CHECK; either
 * tripping yields a clear "loud" failure rather than silent corruption.
 */
export function validateInsert(
  body: Record<string, unknown>,
): ValidatedInsert | { error: string } {
  // name
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2) {
    return { error: "Please enter a name (at least 2 characters)." };
  }
  if (name.length > 80) {
    return { error: "Name is too long (max 80 characters)." };
  }

  // relation
  const relationRaw = typeof body.relation === "string" ? body.relation : "";
  if (!(ALL_RELATIONS as readonly string[]).includes(relationRaw)) {
    return { error: "Pick a relation." };
  }
  const relation = relationRaw as Relation;

  // relation_other — non-empty iff relation === 'other'
  const relationOtherRaw =
    typeof body.relation_other === "string" ? body.relation_other.trim() : "";
  let relation_other: string | null;
  if (relation === "other") {
    if (relationOtherRaw.length === 0) {
      return { error: "Please describe the relation (e.g. \"Father-in-law\")." };
    }
    if (relationOtherRaw.length > 40) {
      return { error: "Relation description is too long (max 40 characters)." };
    }
    relation_other = relationOtherRaw;
  } else {
    // CHECK rejects non-null relation_other when relation !== 'other';
    // we always send null in that case.
    relation_other = null;
  }

  // dob — optional ISO YYYY-MM-DD
  let dob: string | null = null;
  if (body.dob !== undefined && body.dob !== null && body.dob !== "") {
    if (typeof body.dob !== "string" || !YMD_RE.test(body.dob)) {
      return { error: "Date of birth must be in YYYY-MM-DD format." };
    }
    const parsed = new Date(body.dob);
    if (Number.isNaN(parsed.getTime())) {
      return { error: "Date of birth is not a valid date." };
    }
    if (parsed.getTime() > Date.now()) {
      return { error: "Date of birth can't be in the future." };
    }
    dob = body.dob;
  }

  // gender — optional enum
  let gender: Gender | null = null;
  if (body.gender !== undefined && body.gender !== null && body.gender !== "") {
    if (
      typeof body.gender !== "string" ||
      !(ALL_GENDERS as readonly string[]).includes(body.gender)
    ) {
      return { error: "Pick a gender option." };
    }
    gender = body.gender as Gender;
  }

  // notes — optional, trimmed, capped at 500 chars
  let notes: string | null = null;
  if (typeof body.notes === "string") {
    const trimmed = body.notes.trim();
    if (trimmed.length > 500) {
      return { error: "Notes are too long (max 500 characters)." };
    }
    notes = trimmed.length > 0 ? trimmed : null;
  }

  return {
    row: { name, relation, relation_other, dob, gender, notes },
  };
}
