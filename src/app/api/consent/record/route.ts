// POST /api/consent/record
//
// Audit endpoint for DPDP cookie consent decisions. Called fire-and-forget
// from the client after the cookie has been written and gtag('consent',
// 'update') has been dispatched. Writes one row to public.consent_ledger.
//
// Identity resolution:
//   1. ALWAYS — read the anonymous session UUID from the request body
//      (the client minted it via crypto.randomUUID and persisted to
//      sano_anon_sid cookie at the same moment it wrote sano_consent).
//   2. IF a verified patient OTP session cookie exists
//      (sanocare_otp_verify, defined as VERIFY_COOKIE_NAME in
//      src/lib/otp/token.ts) — decode it via verifyToken, look up the
//      customer by phone, populate customer_id.
//   3. Doctor / ops cookies are intentionally ignored. A doctor's
//      personal consent decision when browsing marketing pages is still
//      logged as a visitor; we don't try to correlate it to their staff
//      identity.
//
// IP handling:
//   ip_hash = sha256(raw_ip || CONSENT_IP_HASH_SALT). Raw IP is never
//   stored. If CONSENT_IP_HASH_SALT is unset the field stays null —
//   the row still records (audit > IP traceability). The salt MUST be
//   set in production; a startup advisory in /api/health (future) will
//   surface its absence.
//
// Best-effort semantics:
//   The client's cookie + gtag update have already happened by the
//   time this endpoint is hit. Any failure here means a missed audit
//   row — we still return 200 so the client never spuriously retries
//   and stacks up rows for one decision. Errors are logged
//   server-side via console.error.

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase-server";
import { VERIFY_COOKIE_NAME, verifyToken } from "@/lib/otp/token";

export const runtime = "nodejs";
// Audit endpoint — never cache.
export const dynamic = "force-dynamic";

interface RecordBody {
  analytics: unknown;
  marketing: unknown;
  source: unknown;
  session_id: unknown;
  // timestamp is in the body for parity with the cookie value, but the
  // recorded_at column uses DEFAULT now() — we trust server clock over
  // client clock for the audit timestamp.
  timestamp?: unknown;
}

const VALID_SOURCES = new Set(["banner", "preferences_modal", "footer_link"]);

export async function POST(req: NextRequest) {
  let body: RecordBody;
  try {
    body = (await req.json()) as RecordBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    typeof body.analytics !== "boolean" ||
    typeof body.marketing !== "boolean" ||
    typeof body.source !== "string" ||
    typeof body.session_id !== "string" ||
    !VALID_SOURCES.has(body.source) ||
    !/^[0-9a-f-]{36}$/i.test(body.session_id)
  ) {
    return NextResponse.json(
      { error: "Body must contain analytics:boolean, marketing:boolean, source:'banner'|'preferences_modal'|'footer_link', session_id:uuid." },
      { status: 400 },
    );
  }

  // Resolve customer_id from the OTP session cookie if present.
  let customerId: string | null = null;
  const verifyCookie = req.cookies.get(VERIFY_COOKIE_NAME)?.value;
  const verified = verifyToken(verifyCookie);
  if (verified) {
    const { data: customer } = await supabaseAdmin
      .from("customers")
      .select("id")
      .eq("phone", verified.phone)
      .maybeSingle();
    if (customer?.id) {
      customerId = customer.id as string;
    }
  }

  // Hash the IP for abuse-pattern review. Salt rotation invalidates
  // correlation across historical rows — intentional.
  let ipHash: string | null = null;
  const salt = process.env.CONSENT_IP_HASH_SALT;
  const rawIp = extractClientIp(req);
  if (salt && rawIp) {
    ipHash = createHash("sha256").update(rawIp + salt).digest("hex");
  }

  // user_agent capped at 512 chars so a pathological client header
  // can't bloat the audit table.
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 512) || null;

  const { error } = await supabaseAdmin.from("consent_ledger").insert({
    customer_id: customerId,
    session_id: body.session_id,
    analytics: body.analytics,
    marketing: body.marketing,
    source: body.source,
    user_agent: ua,
    ip_hash: ipHash,
  });

  if (error) {
    console.error("[consent/record] insert failed:", error);
    // Still return 200 — see best-effort note in the file header.
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * Extract the client IP, honoring proxy headers Netlify sets in front
 * of the Next.js function. Falls back through the standard chain.
 */
function extractClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    // x-forwarded-for: client, proxy1, proxy2 — first entry is the
    // originating client.
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  // NextRequest no longer exposes a stable .ip property in Next 16; the
  // header fallbacks above are the canonical source on Netlify.
  return null;
}
