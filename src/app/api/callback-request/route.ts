// POST /api/callback-request
//
// Homepage Quick Book endpoint. Patient enters name + phone on the
// hero card; we record it to callback_requests (M034) so ops can
// ring back. NOT a booking — no service category, address, or GPS
// yet. Once ops makes contact and the patient picks a service, ops
// creates the real booking via /ops/bookings/new and (optional)
// updates this row to mark it converted.
//
// Mirrors the shape of /api/consent/record (service-role write,
// best-effort 200, IP hashing, user-agent capping).
//
// Validation:
//   - Body must be JSON with `name` (1-100 chars after trim) and
//     `phone` (passes normaliseIndianPhone → E.164 +91...)
//   - Phone is stored normalised. Malformed phone → 400.
//   - Source defaults to 'homepage_quick_book' (the only value the
//     M034 CHECK constraint currently accepts; future sources land
//     in a follow-up migration when more landing pages ship).
//
// IP hashing:
//   ip_hash = sha256(raw_ip || $CONSENT_IP_HASH_SALT) — reuses the
//   M033 salt env var. If unset, ip_hash stays null (audit row still
//   records). Same behavior as /api/consent/record.

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase-server";
import { normaliseIndianPhone } from "@/lib/otp/token";

export const runtime = "nodejs";
// Audit endpoint — never cache.
export const dynamic = "force-dynamic";

interface RequestBody {
  name: unknown;
  phone: unknown;
}

const NAME_MAX_LEN = 100;
const USER_AGENT_CAP = 512;

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Name — trimmed, non-empty, capped.
  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  if (!rawName) {
    return NextResponse.json({ error: "Please share your name." }, { status: 400 });
  }
  if (rawName.length > NAME_MAX_LEN) {
    return NextResponse.json(
      { error: `Name is too long (max ${NAME_MAX_LEN} characters).` },
      { status: 400 },
    );
  }

  // Phone — normalise to E.164 +91NNNNNNNNNN. Rejects anything else.
  const rawPhone = typeof body.phone === "string" ? body.phone : "";
  const phone = normaliseIndianPhone(rawPhone);
  if (!phone) {
    return NextResponse.json(
      {
        error:
          "Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.",
      },
      { status: 400 },
    );
  }

  // IP hash — sha256(raw_ip || salt). Raw IP never stored.
  // Reuses CONSENT_IP_HASH_SALT (set on Netlify prod for M033).
  let ipHash: string | null = null;
  const salt = process.env.CONSENT_IP_HASH_SALT;
  const rawIp = extractClientIp(req);
  if (salt && rawIp) {
    ipHash = createHash("sha256").update(rawIp + salt).digest("hex");
  }

  // user_agent capped so a pathological client header can't bloat
  // the audit table.
  const ua = (req.headers.get("user-agent") ?? "").slice(0, USER_AGENT_CAP) || null;

  const { error } = await supabaseAdmin.from("callback_requests").insert({
    name: rawName,
    phone,
    source: "homepage_quick_book",
    user_agent: ua,
    ip_hash: ipHash,
  });

  if (error) {
    console.error("[callback-request] insert failed:", error);
    return NextResponse.json(
      { error: "Could not record your request. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

/**
 * Extract the client IP, honoring proxy headers Netlify sets in front
 * of the Next.js function. Mirrors /api/consent/record.
 */
function extractClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return null;
}
