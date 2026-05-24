import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  DOCTOR_SESSION_COOKIE_NAME,
  DOCTOR_TOKEN_TTL_SECONDS,
  OTP_MAX_ATTEMPTS,
  hashOtp,
  hashesEqual,
  mintDoctorToken,
  normaliseIndianPhone,
} from "@/lib/otp/token";

export const runtime = "nodejs";

/**
 * POST /api/doctor/verify-otp
 *
 * Body: { phone: string, otp: string }
 *
 * Mirrors /api/auth/verify-otp's OTP-check logic (same otp_verifications
 * table, same hash compare, same lockout posture), then differs in the
 * success path:
 *   - Re-look-up an ACTIVE doctor by the normalised phone.
 *   - Mint a doctor session JWT carrying { doctor_id, phone } via
 *     mintDoctorToken().
 *   - Set the HttpOnly cookie `sanocare_doctor_session`.
 *
 * The doctor row could in theory be deactivated between send-otp and
 * verify-otp; we re-fetch with is_active = true and reject with 401 if
 * it's gone — the cookie never gets minted in that case.
 *
 * Returns:
 *   200 { ok: true, doctor_id, phone, doctor_code, full_name }
 *   400 { error }
 *   401 { error, attemptsRemaining? }   — wrong / expired / locked / inactive
 *   500 { error }
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
      { error: "Please enter the 6-digit code." },
      { status: 400 },
    );
  }

  // Look up the latest unverified, unexpired OTP row for this phone.
  const { data: row, error: lookupErr } = await supabaseAdmin
    .from("otp_verifications")
    .select("id, otp_hash, attempts, expires_at, verified_at")
    .eq("phone", phone)
    .is("verified_at", null)
    .gte("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lookupErr) {
    console.error("[doctor-verify-otp] OTP lookup failed:", lookupErr);
    return NextResponse.json({ error: "Could not verify code. Try again." }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json(
      { error: "No active code for this number. Please request a new one." },
      { status: 401 },
    );
  }

  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: "Too many wrong attempts on this code. Please request a fresh code." },
      { status: 401 },
    );
  }

  let candidateHash: string;
  try {
    candidateHash = hashOtp(otp);
  } catch (err) {
    console.error("[doctor-verify-otp] hash failed:", err);
    return NextResponse.json({ error: "Server is misconfigured." }, { status: 500 });
  }

  const matches = hashesEqual(candidateHash, row.otp_hash);
  if (!matches) {
    const newAttempts = row.attempts + 1;
    await supabaseAdmin
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

  // OTP correct. Re-look-up the doctor — guards against a doctor that
  // was deactivated between send-otp and verify-otp.
  const { data: doctor, error: doctorErr } = await supabaseAdmin
    .from("doctors")
    .select("id, doctor_code, full_name, is_active")
    .eq("phone", phone)
    .eq("is_active", true)
    .maybeSingle();
  if (doctorErr) {
    console.error("[doctor-verify-otp] doctor lookup failed:", doctorErr);
    return NextResponse.json({ error: "Could not complete sign-in. Try again." }, { status: 500 });
  }
  if (!doctor) {
    // Either no doctor with this phone, or they were deactivated since
    // the OTP was sent. Don't mint a session.
    return NextResponse.json(
      { error: "This account isn't active. Contact ops if you believe this is wrong." },
      { status: 401 },
    );
  }

  // Mark the OTP row verified so it can't be reused.
  const verifiedAt = new Date().toISOString();
  const { error: markErr } = await supabaseAdmin
    .from("otp_verifications")
    .update({ verified_at: verifiedAt })
    .eq("id", row.id);
  if (markErr) {
    console.error("[doctor-verify-otp] mark verified failed:", markErr);
    return NextResponse.json({ error: "Could not record verification." }, { status: 500 });
  }

  // Mint the doctor session token and set the cookie.
  let token: string;
  try {
    token = mintDoctorToken({ doctor_id: doctor.id, phone });
  } catch (err) {
    console.error("[doctor-verify-otp] token mint failed:", err);
    return NextResponse.json({ error: "Server is misconfigured." }, { status: 500 });
  }

  const response = NextResponse.json({
    ok: true,
    doctor_id: doctor.id,
    doctor_code: doctor.doctor_code,
    full_name: doctor.full_name,
    phone,
  });
  response.cookies.set({
    name: DOCTOR_SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DOCTOR_TOKEN_TTL_SECONDS,
  });
  console.log("[doctor-verify-otp] success", { phone, doctor_code: doctor.doctor_code });
  return response;
}
