import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  OTP_MAX_ATTEMPTS,
  TOKEN_TTL_SECONDS,
  VERIFY_COOKIE_NAME,
  hashOtp,
  hashesEqual,
  mintVerificationToken,
  normaliseIndianPhone,
} from "@/lib/otp/token";

export const runtime = "nodejs";

/**
 * POST /api/auth/verify-otp
 *
 * Body: { phone: string, otp: string }
 *
 * On success: sets the `sanocare_otp_verify` HttpOnly cookie with the
 * signed verification token, returns 200 + the verified phone in E.164.
 * The booking-insert routes read the cookie on each submit.
 *
 * Lockout: after OTP_MAX_ATTEMPTS failed attempts against the same OTP
 * row, that row is exhausted; the patient must request a new code. The
 * 5/hr per-phone send limit (enforced in /api/auth/send-otp) keeps
 * brute-force across multiple OTPs bounded.
 *
 * Returns:
 *   200 { ok: true, phone, customer_id, full_name }
 *           - customer_id: UUID of the customers row for this phone (resolved
 *             after OTP success; auto-upserted if the phone is new). Used by
 *             clients to seed the bookingStore identity cache.
 *           - full_name: customers.full_name when the row pre-existed and was
 *             populated by Pulse signup / ops UI. NULL for fresh auto-upserts
 *             OR for legacy rows that never captured a name. Clients use a
 *             non-null value to pre-fill the IdentifyStep / LabBasketWindow
 *             name input.
 *   400 { error }
 *   401 { error, attemptsRemaining? }   — wrong / expired / locked
 *   500 { error }
 *
 * The customer auto-upsert lands here (rather than at booking-insert time)
 * so T64's MemberPicker (PR2) can show family_members for the customer
 * BEFORE the patient submits a booking. Requires M043 (drop NOT NULL on
 * customers.full_name + customer_code) — applied 2026-06-09.
 */
export async function POST(req: NextRequest) {
  let body: { phone?: string; otp?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const phone = normaliseIndianPhone(String(body.phone ?? ""));
  if (!phone) {
    return NextResponse.json(
      { error: "Please enter a valid 10-digit Indian mobile number." },
      { status: 400 },
    );
  }

  const otp = String(body.otp ?? "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(otp)) {
    return NextResponse.json(
      { error: "Please enter the 6-digit code from WhatsApp." },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Server is misconfigured. Please try again later." },
      { status: 500 },
    );
  }

  // Look up the latest unverified, unexpired row for this phone.
  const { data: row, error: lookupErr } = await supabase
    .from("otp_verifications")
    .select("id, otp_hash, attempts, expires_at, verified_at")
    .eq("phone", phone)
    .is("verified_at", null)
    .gte("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lookupErr) {
    console.error("[verify-otp] lookup failed:", lookupErr);
    return NextResponse.json({ error: "Could not verify code. Try again." }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json(
      {
        error:
          "No active code for this number. Please request a new one.",
      },
      { status: 401 },
    );
  }

  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    return NextResponse.json(
      {
        error:
          "Too many wrong attempts on this code. Please request a fresh code.",
      },
      { status: 401 },
    );
  }

  let candidateHash: string;
  try {
    candidateHash = hashOtp(otp);
  } catch (err) {
    console.error("[verify-otp] hash failed:", err);
    return NextResponse.json({ error: "Server is misconfigured." }, { status: 500 });
  }

  const matches = hashesEqual(candidateHash, row.otp_hash);
  if (!matches) {
    const newAttempts = row.attempts + 1;
    await supabase
      .from("otp_verifications")
      .update({ attempts: newAttempts })
      .eq("id", row.id);
    const attemptsRemaining = Math.max(0, OTP_MAX_ATTEMPTS - newAttempts);
    return NextResponse.json(
      {
        error:
          attemptsRemaining > 0
            ? `That code didn't match. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} remaining.`
            : "Too many wrong attempts. Please request a fresh code.",
        attemptsRemaining,
      },
      { status: 401 },
    );
  }

  // Match — mark verified.
  const verifiedAt = new Date().toISOString();
  const { error: markErr } = await supabase
    .from("otp_verifications")
    .update({ verified_at: verifiedAt })
    .eq("id", row.id);
  if (markErr) {
    console.error("[verify-otp] mark verified failed:", markErr);
    return NextResponse.json({ error: "Could not record verification." }, { status: 500 });
  }

  // Mint the signed token and stamp it onto an HttpOnly cookie.
  let token: string;
  try {
    token = mintVerificationToken(phone);
  } catch (err) {
    console.error("[verify-otp] token mint failed:", err);
    return NextResponse.json({ error: "Server is misconfigured." }, { status: 500 });
  }

  // T64 + customer-link-hotpatch follow-up: resolve (or create) the
  // customers row for this phone and surface its id + name to the client.
  // Soft-fail: any error in this block degrades gracefully (response
  // returns customer_id/full_name as null) — the OTP cookie is the actual
  // gate; the customer linkage is convenience for pre-fill + MemberPicker.
  let customerId: string | null = null;
  let customerFullName: string | null = null;
  try {
    const { data: existing, error: lookupErr } = await supabase
      .from("customers")
      .select("id, full_name")
      .eq("phone", phone)
      .maybeSingle();
    if (lookupErr) {
      console.error("[verify-otp] customer lookup failed:", lookupErr);
    } else if (existing?.id) {
      customerId = existing.id as string;
      customerFullName = (existing.full_name as string | null) ?? null;
    } else {
      // No existing row — auto-upsert with phone only. M043 dropped NOT
      // NULL on full_name + customer_code so this minimal insert succeeds;
      // both columns stay NULL until the patient types their name (booking
      // form / Pulse signup) or ops fills them in.
      const { data: created, error: insertErr } = await supabase
        .from("customers")
        .insert({ phone })
        .select("id, full_name")
        .single();
      if (insertErr) {
        console.error("[verify-otp] customer auto-upsert failed:", insertErr);
      } else if (created?.id) {
        customerId = created.id as string;
        customerFullName = (created.full_name as string | null) ?? null;
      }
    }
  } catch (cause) {
    console.error("[verify-otp] customer resolve threw unexpectedly", cause);
  }

  const response = NextResponse.json({
    ok: true,
    phone,
    customer_id: customerId,
    full_name: customerFullName,
  });
  response.cookies.set({
    name: VERIFY_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TOKEN_TTL_SECONDS,
  });
  return response;
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
