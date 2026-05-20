import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  OTP_MAX_SENDS_PER_HOUR,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  generateOtp,
  hashOtp,
  normaliseIndianPhone,
} from "@/lib/otp/token";
import { OtpDeliveryError, sendOtp, type OtpChannel } from "@/lib/otp/sender";

export const runtime = "nodejs";

/**
 * POST /api/auth/send-otp
 *
 * Body: { phone: string, channel?: 'whatsapp' | 'sms' | 'auto' }
 *
 * Rate limits enforced server-side:
 *   - 30s cooldown between sends to the same phone
 *   - 5 sends max per phone per rolling hour
 * Cooldown / limit responses return 429 with `retryAfterSeconds` so the
 * BookingGate UI can render a countdown.
 *
 * Returns:
 *   200 { ok: true, channel, expiresInSeconds }
 *   400 { error }  — bad phone, channel unsupported
 *   429 { error, retryAfterSeconds }
 *   502 { error }  — provider delivery failed; row was NOT inserted so the
 *                    next attempt is allowed immediately
 *   500 { error }  — env / supabase issue
 */
export async function POST(req: NextRequest) {
  let body: { phone?: string; channel?: string };
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

  const requested = String(body.channel ?? "auto").toLowerCase();
  const channel = resolveChannel(requested);
  if (!channel) {
    return NextResponse.json(
      { error: "SMS is not available yet. Please use WhatsApp." },
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

  // ===== Rate-limit / cooldown =====
  const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recent, error: recentErr } = await supabase
    .from("otp_verifications")
    .select("created_at")
    .eq("phone", phone)
    .gte("created_at", oneHourAgoIso)
    .order("created_at", { ascending: false });
  if (recentErr) {
    console.error("[send-otp] lookup failed:", recentErr);
    return NextResponse.json({ error: "Could not send code. Try again." }, { status: 500 });
  }

  if (recent && recent.length >= OTP_MAX_SENDS_PER_HOUR) {
    return NextResponse.json(
      {
        error:
          "Too many code requests for this number. Please try again in an hour or call +91-9711977782.",
        retryAfterSeconds: 60 * 60,
      },
      { status: 429 },
    );
  }
  if (recent && recent.length > 0) {
    const last = new Date(recent[0].created_at).getTime();
    const elapsed = (Date.now() - last) / 1000;
    if (elapsed < OTP_RESEND_COOLDOWN_SECONDS) {
      return NextResponse.json(
        {
          error: `Please wait ${Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed)}s before requesting another code.`,
          retryAfterSeconds: Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed),
        },
        { status: 429 },
      );
    }
  }

  // ===== Generate + dispatch =====
  const code = generateOtp();
  let otpHash: string;
  try {
    otpHash = hashOtp(code);
  } catch (err) {
    console.error("[send-otp] hash failed:", err);
    return NextResponse.json({ error: "Server is misconfigured." }, { status: 500 });
  }

  try {
    await sendOtp({ phone, code, channel });
  } catch (err) {
    const channelLabel = channel === "whatsapp" ? "WhatsApp" : "SMS";
    console.error(`[send-otp] ${channelLabel} delivery failed:`, err);
    if (err instanceof OtpDeliveryError) {
      return NextResponse.json(
        {
          error: `We couldn't send the code on ${channelLabel}. Please try again${channel === "whatsapp" ? " or use SMS" : ""}.`,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "Could not send code. Try again." },
      { status: 502 },
    );
  }

  // Insert AFTER successful dispatch so failed deliveries don't burn the
  // cooldown window. Provider-side duplicates (rare) are tolerated since the
  // OTP is single-use anyway.
  const expiresAtIso = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();
  const { error: insertErr } = await supabase.from("otp_verifications").insert({
    phone,
    otp_hash: otpHash,
    channel,
    expires_at: expiresAtIso,
  });
  if (insertErr) {
    // The OTP went out but we couldn't persist it. The user will get a code
    // they can't verify. Surface a clear error so they retry; the cooldown
    // didn't kick in since we never inserted.
    console.error("[send-otp] insert failed after dispatch:", insertErr);
    return NextResponse.json(
      { error: "Code sent, but we couldn't track it. Please request another." },
      { status: 500 },
    );
  }

  // Opportunistic cleanup. Cheap on the index, no need for a cron yet.
  // Wrapped in an IIFE so we don't await and so the rpc's specialised
  // PromiseLike (no .catch) doesn't surface to the route's return path.
  void (async () => {
    try {
      await supabase.rpc("purge_old_otp_verifications");
    } catch {
      /* best-effort; failures are non-fatal */
    }
  })();

  return NextResponse.json({
    ok: true,
    channel,
    expiresInSeconds: OTP_TTL_SECONDS,
  });
}

function resolveChannel(requested: string): OtpChannel | null {
  const defaultChannel = (process.env.OTP_DEFAULT_CHANNEL ?? "whatsapp") as OtpChannel;
  const smsEnabled = process.env.SMS_OTP_ENABLED === "true";
  if (requested === "sms") {
    return smsEnabled ? "sms" : null;
  }
  if (requested === "whatsapp") {
    return "whatsapp";
  }
  // 'auto' or anything else
  return defaultChannel === "sms" && smsEnabled ? "sms" : "whatsapp";
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
