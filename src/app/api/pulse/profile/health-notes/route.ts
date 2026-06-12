import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/pulse/profile/health-notes
 *
 * T90 Slice 2 Step 13 — partial-update health notes for the Profile
 * tab (Surface 8). Single endpoint dispatched by target:
 *
 *   { target: 'self', health_notes: string | null }
 *     → UPDATE customers   SET health_notes = $1 WHERE id = caller.id
 *
 *   { target: { kind: 'member', memberId: <uuid> }, health_notes: string | null }
 *     → UPDATE family_members SET health_notes = $1
 *         WHERE id = $2 AND customer_id = caller.id
 *       (the customer_id WHERE clause is the ownership gate — a 403
 *        path masked as 404 if memberId belongs to a different
 *        caregiver, so we don't leak that the id exists.)
 *
 * Body:
 *   {
 *     target: 'self' | { kind: 'member', memberId: string },
 *     health_notes: string | null
 *   }
 *   - empty string / whitespace → stored as NULL (consistent UX:
 *     "clear my notes" = save empty)
 *   - non-empty trimmed length must be ≤ 500 chars (brief Surface 8
 *     helper "Up to 500 characters.")
 *
 * Auth: requirePulseCustomer (OTP verify cookie). Self path is
 * cookie-scoped; member path is cookie-scoped AND verifies the
 * member belongs to the caller via the WHERE clause.
 *
 * Returns:
 *   200 { health_notes: string | null }
 *   400 { error }       — invalid body / target / length cap
 *   401 { error }       — no valid verify cookie
 *   404 { error }       — member path: id not owned by caller (or doesn't exist)
 *   500 { error }       — DB error
 *
 * Why NOT extend the existing /api/pulse/family-members/[id] PATCH:
 * that endpoint is a full-overwrite (treats every field as required)
 * to satisfy AddMemberForm's contract. Partial updates here would
 * require changing the contract on a route already in production —
 * higher risk than a small dedicated endpoint (founder push-back F).
 */

const HEALTH_NOTES_MAX_LENGTH = 500;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SelfTarget = "self";
type MemberTarget = { kind: "member"; memberId: string };
type Target = SelfTarget | MemberTarget;

export async function POST(req: NextRequest) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  let body: { target?: unknown; health_notes?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const target = validateTarget(body.target);
  if ("error" in target) {
    return NextResponse.json({ error: target.error }, { status: 400 });
  }

  // Normalise health_notes — accept string | null | undefined; empty
  // string / whitespace folds to NULL so "clear my notes" is a
  // first-class action.
  let normalized: string | null;
  if (body.health_notes === null || body.health_notes === undefined) {
    normalized = null;
  } else if (typeof body.health_notes === "string") {
    const trimmed = body.health_notes.trim();
    normalized = trimmed.length === 0 ? null : trimmed;
  } else {
    return NextResponse.json(
      { error: "health_notes must be a string or null." },
      { status: 400 },
    );
  }

  if (normalized !== null && normalized.length > HEALTH_NOTES_MAX_LENGTH) {
    return NextResponse.json(
      {
        error: `Health notes are too long (max ${HEALTH_NOTES_MAX_LENGTH} characters).`,
      },
      { status: 400 },
    );
  }

  if (target.value === "self") {
    const { error } = await supabaseAdmin
      .from("customers")
      .update({ health_notes: normalized })
      .eq("id", customer.id);

    if (error) {
      console.error("[pulse/profile/health-notes] self update failed:", error);
      return NextResponse.json(
        { error: "Could not save notes. Try again." },
        { status: 500 },
      );
    }
    return NextResponse.json({ health_notes: normalized });
  }

  // Member path — the .eq('customer_id', caller.id) clause is the
  // ownership gate. PostgREST returns PGRST116 (no rows) if the
  // memberId belongs to a different caregiver — we map that to 404
  // rather than 403 so we don't leak that the id exists in some other
  // customer's tree.
  const { error, count } = await supabaseAdmin
    .from("family_members")
    .update(
      {
        health_notes: normalized,
        updated_at: new Date().toISOString(),
      },
      { count: "exact" },
    )
    .eq("id", target.value.memberId)
    .eq("customer_id", customer.id);

  if (error) {
    console.error("[pulse/profile/health-notes] member update failed:", error);
    return NextResponse.json(
      { error: "Could not save notes. Try again." },
      { status: 500 },
    );
  }
  if (count === 0) {
    return NextResponse.json(
      { error: "Member not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ health_notes: normalized });
}

function validateTarget(
  raw: unknown,
):
  | { value: Target }
  | { error: string } {
  if (raw === "self") return { value: "self" };
  if (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { kind?: unknown }).kind === "member"
  ) {
    const memberId = (raw as { memberId?: unknown }).memberId;
    if (typeof memberId !== "string" || !UUID_RE.test(memberId)) {
      return { error: "Invalid memberId." };
    }
    return { value: { kind: "member", memberId } };
  }
  return {
    error:
      "target must be 'self' or { kind: 'member', memberId: <uuid> }.",
  };
}
