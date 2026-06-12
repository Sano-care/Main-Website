import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/pulse/profile/email
 *
 * T90 Slice 2 Step 13 — self-only email PATCH for the Profile tab
 * (Surface 8). Family members don't have email in Phase 1, so this
 * route is intentionally locked to the caller's own customers row.
 *
 * Body:
 *   { email: string | null }
 *     - empty string / whitespace → stored as NULL
 *     - non-empty must match pragmatic shape  /^[^\s@]+@[^\s@]+\.[^\s@]+$/
 *     - max 254 chars (RFC 5321 SMTP cap; pragmatic, not the maddening
 *       full RFC 5322 + 6531 parser)
 *
 * Auth: requirePulseCustomer (OTP verify cookie). Writes
 * customers.email WHERE id = caller's customer_id ONLY — no target
 * param accepted; server reads identity from the cookie.
 *
 * Returns:
 *   200 { email: string | null }  — the canonical stored value
 *   400 { error }                 — invalid body / validation
 *   401 { error }                 — no valid verify cookie
 *   500 { error }                 — DB error
 */

// Pragmatic; matches "real" emails 99.9% of the time. Not the IETF monster
// — see plan-gate note (founder reminder 3).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254;

export async function POST(req: NextRequest) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Normalise the input. We accept string | null | undefined; non-string
  // shapes (objects, booleans) get rejected as 400.
  let normalized: string | null;
  if (body.email === null || body.email === undefined) {
    normalized = null;
  } else if (typeof body.email === "string") {
    const trimmed = body.email.trim();
    normalized = trimmed.length === 0 ? null : trimmed;
  } else {
    return NextResponse.json(
      { error: "email must be a string or null." },
      { status: 400 },
    );
  }

  if (normalized !== null) {
    if (normalized.length > EMAIL_MAX_LENGTH) {
      return NextResponse.json(
        { error: `Email is too long (max ${EMAIL_MAX_LENGTH} characters).` },
        { status: 400 },
      );
    }
    if (!EMAIL_RE.test(normalized)) {
      return NextResponse.json(
        { error: "That doesn't look like a valid email. Try again." },
        { status: 400 },
      );
    }
  }

  const { error } = await supabaseAdmin
    .from("customers")
    .update({ email: normalized })
    .eq("id", customer.id);

  if (error) {
    console.error("[pulse/profile/email] update failed:", error);
    return NextResponse.json(
      { error: "Could not save email. Try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ email: normalized });
}
