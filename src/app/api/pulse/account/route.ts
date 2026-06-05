import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { VERIFY_COOKIE_NAME, verifyToken } from "@/lib/otp/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Account resolution for the Sanocare Pulse login flow.
//
// This is the bridge between "OTP verified" (cookie set by
// /api/auth/verify-otp) and "has a customers row". The login page calls:
//
//   GET  /api/pulse/account  → after OTP success, find out whether this
//                              verified phone already has a customer. If yes,
//                              redirect into Pulse. If no, show name capture.
//   POST /api/pulse/account  → create the customer from the captured name,
//                              then redirect into Pulse.
//
// Both require a valid verify cookie (the OTP must already be confirmed);
// neither mints or refreshes it — the cookie lifecycle stays owned by the
// shared /api/auth/* routes. There is NO parallel auth here.

interface VerifiedAccountContext {
  phone: string;
}

/** Pull + verify the OTP cookie, or return a 401 response. */
function requireVerifiedPhone(
  req: NextRequest,
): VerifiedAccountContext | NextResponse {
  const token = req.cookies.get(VERIFY_COOKIE_NAME)?.value;
  const verified = verifyToken(token);
  if (!verified) {
    return NextResponse.json(
      { error: "Verify your number to continue." },
      { status: 401 },
    );
  }
  return { phone: verified.phone };
}

/**
 * GET /api/pulse/account
 *
 * 200 { customer: { id, full_name } | null, phone }
 * 401 { error }  — no / invalid / expired verify cookie
 */
export async function GET(req: NextRequest) {
  const ctx = requireVerifiedPhone(req);
  if (ctx instanceof NextResponse) return ctx;

  const { data, error } = await supabaseAdmin
    .from("customers")
    .select("id, full_name")
    .eq("phone", ctx.phone)
    .maybeSingle();

  if (error) {
    console.error("[pulse/account] GET lookup failed:", error);
    return NextResponse.json(
      { error: "Could not load your account. Try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    customer: data?.id
      ? { id: data.id as string, full_name: (data.full_name as string | null) ?? null }
      : null,
    phone: ctx.phone,
  });
}

/**
 * POST /api/pulse/account
 *
 * Body: { full_name: string }
 *
 * Creates the customer for the verified phone (self-signup; no separate
 * sign-up surface). Idempotent: if a row already exists for the phone it is
 * returned as-is rather than erroring, so a double-submit can't fork the
 * account or trip the phone UNIQUE constraint.
 *
 * 200 { customer: { id, full_name } }
 * 400 { error }  — missing / too-short name
 * 401 { error }  — no valid verify cookie
 * 500 { error }
 */
export async function POST(req: NextRequest) {
  const ctx = requireVerifiedPhone(req);
  if (ctx instanceof NextResponse) return ctx;

  let body: { full_name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const full_name =
    typeof body.full_name === "string" ? body.full_name.trim() : "";
  if (full_name.length < 2) {
    return NextResponse.json(
      { error: "Please enter your name so we know who to greet." },
      { status: 400 },
    );
  }
  if (full_name.length > 120) {
    return NextResponse.json(
      { error: "That name looks too long. Please shorten it." },
      { status: 400 },
    );
  }

  // Idempotency guard — return the existing row if signup raced or the
  // patient already exists (e.g. created via a prior booking).
  const { data: existing } = await supabaseAdmin
    .from("customers")
    .select("id, full_name")
    .eq("phone", ctx.phone)
    .maybeSingle();
  if (existing?.id) {
    return NextResponse.json({
      customer: {
        id: existing.id as string,
        full_name: (existing.full_name as string | null) ?? full_name,
      },
    });
  }

  // Allocate a SAN-C-NNNNN code via the shared sequence RPC so Pulse
  // self-signups are indistinguishable from ops-created customers.
  const { data: code, error: codeErr } = await supabaseAdmin.rpc("next_code", {
    p_type: "customer",
  });
  if (codeErr || !code) {
    console.error("[pulse/account] code allocation failed:", codeErr);
    return NextResponse.json(
      { error: "Could not create your account. Try again." },
      { status: 500 },
    );
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("customers")
    .insert({
      customer_code: code,
      full_name,
      phone: ctx.phone,
    })
    .select("id, full_name")
    .single();

  if (insertErr || !inserted) {
    console.error("[pulse/account] insert failed:", insertErr);
    return NextResponse.json(
      { error: "Could not create your account. Try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    customer: {
      id: inserted.id as string,
      full_name: (inserted.full_name as string | null) ?? full_name,
    },
  });
}
