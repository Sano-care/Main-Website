import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
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
 * POST /api/doctor/send-otp
 *
 * Doctor-side wrapper over the patient OTP send. Identical rate-limit
 * and channel-resolution posture as /api/auth/send-otp (so the same
 * Rampwin/WhatsApp/SMS infrastructure carries doctor OTPs), with one
 * extra gate up front: we only dispatch if the normalised phone matches
 * an ACTIVE row in public.doctors. This blocks "OTP fishing" — a random
 * phone can't probe whether it belongs to a doctor by trying to log in.
 *
 * Body: { phone: string, channel?: 'whatsapp' | 'sms' | 'rampwin' | 'auto' }
 *
 * Returns:
 *   200 { ok: true, channel, expiresInSeconds }
 *   400 { error }   — bad phone / channel unsupported / no doctor found
 *   429 { error, retryAfterSeconds }
 *   502 { error }   — provider delivery failed; row NOT inserted
 *   500 { error }   — env / supabase issue
 *
 * Note: the otp_verifications table is shared with the patient flow. A
 * doctor and a patient on the same phone (rare in practice — they're
 * usually different humans) would share the rate-limit window. That is
 * acceptable: it preserves the "5 OTPs / phone / hour" cap regardless of
 * which surface initiated them.
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
    console.log("[doctor-send-otp] rejected: invalid phone input");
    return NextResponse.json(
      { error: "Please enter a valid 10-digit Indian mobile number." },
      { status: 400 },
    );
  }

  const requested = String(body.channel ?? "auto").toLowerCase();
  const bypassDispatch = process.env.OTP_DEV_BYPASS === "true";

  console.log("[doctor-send-otp] entered", {
    phone,
    requested,
    OTP_DEV_BYPASS: process.env.OTP_DEV_BYPASS ?? "(unset)",
    OTP_DEFAULT_CHANNEL: process.env.OTP_DEFAULT_CHANNEL ?? "(unset)",
    RAMPWIN_OTP_ENABLED: process.env.RAMPWIN_OTP_ENABLED ?? "(unset)",
    WHATSAPP_OTP_ENABLED: process.env.WHATSAPP_OTP_ENABLED ?? "(unset)",
    SMS_OTP_ENABLED: process.env.SMS_OTP_ENABLED ?? "(unset)",
    bypassDispatch,
  });

  // ===== Doctor existence gate =====
  // Look up an ACTIVE doctor by the normalised phone. If none, we return a
  // generic 400 — deliberately not "no doctor with this phone" — so the
  // endpoint can't be used as an existence oracle. The internal log line
  // is specific for debugging.
  const { data: doctor, error: doctorLookupErr } = await supabaseAdmin
    .from("doctors")
    .select("id, doctor_code, is_active")
    .eq("phone", phone)
    .eq("is_active", true)
    .maybeSingle();
  if (doctorLookupErr) {
    console.error("[doctor-send-otp] doctor lookup failed:", doctorLookupErr);
    return NextResponse.json(
      { error: "Could not send code. Try again." },
      { status: 500 },
    );
  }
  if (!doctor) {
    console.log("[doctor-send-otp] no active doctor for phone", { phone });
    return NextResponse.json(
      {
        error:
          "We don't recognise that number for a Sanocare doctor account. Contact ops if you think this is a mistake.",
      },
      { status: 400 },
    );
  }
  console.log("[doctor-send-otp] doctor matched", { phone, doctor_code: doctor.doctor_code });

  // ===== Channel resolution (mirrors /api/auth/send-otp) =====
  const channel: OtpChannel | null = bypassDispatch
    ? requested === "rampwin"
      ? "rampwin"
      : requested === "whatsapp"
        ? "whatsapp"
        : "sms"
    : resolveChannel(requested);
  if (!channel) {
    console.log("[doctor-send-otp] no usable channel", { requested });
    return NextResponse.json(
      {
        error:
          requested === "sms"
            ? "SMS is not available right now. Please try WhatsApp."
            : requested === "whatsapp"
              ? "WhatsApp OTP is temporarily unavailable. Please try SMS."
              : "OTP delivery is temporarily unavailable. Please try again shortly.",
      },
      { status: 400 },
    );
  }

  // ===== Rate-limit / cooldown (shared otp_verifications table) =====
  const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recent, error: recentErr } = await supabaseAdmin
    .from("otp_verifications")
    .select("created_at")
    .eq("phone", phone)
    .gte("created_at", oneHourAgoIso)
    .order("created_at", { ascending: false });
  if (recentErr) {
    console.error("[doctor-send-otp] lookup failed:", recentErr);
    return NextResponse.json({ error: "Could not send code. Try again." }, { status: 500 });
  }

  if (recent && recent.length >= OTP_MAX_SENDS_PER_HOUR) {
    console.log("[doctor-send-otp] rate-limit hit", { phone, sendsInLastHour: recent.length });
    return NextResponse.json(
      {
        error:
          "Too many code requests for this number. Please try again in an hour.",
        retryAfterSeconds: 60 * 60,
      },
      { status: 429 },
    );
  }
  if (recent && recent.length > 0) {
    const last = new Date(recent[0].created_at).getTime();
    const elapsed = (Date.now() - last) / 1000;
    if (elapsed < OTP_RESEND_COOLDOWN_SECONDS) {
      console.log("[doctor-send-otp] cooldown hit", { phone, elapsedSeconds: Math.round(elapsed) });
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
    console.error("[doctor-send-otp] hash failed:", err);
    return NextResponse.json({ error: "Server is misconfigured." }, { status: 500 });
  }

  if (bypassDispatch) {
    console.warn(
      `[doctor-send-otp] OTP_DEV_BYPASS active — code for ${phone} is ${code}. Provider dispatch SKIPPED. Disable this flag before going live.`,
    );
  } else {
    console.log("[doctor-send-otp] dispatching via provider", { channel });
    try {
      await sendOtp({ phone, code, channel });
      console.log("[doctor-send-otp] dispatch ok", { channel });
    } catch (err) {
      const channelLabel = channel === "whatsapp" || channel === "rampwin" ? "WhatsApp" : "SMS";
      console.error(`[doctor-send-otp] ${channelLabel} delivery failed:`, err);
      if (err instanceof OtpDeliveryError) {
        return NextResponse.json(
          {
            error: `We couldn't send the code on ${channelLabel}. Please try again${channel !== "sms" ? " or use SMS" : ""}.`,
          },
          { status: 502 },
        );
      }
      return NextResponse.json(
        { error: "Could not send code. Try again." },
        { status: 502 },
      );
    }
  }

  // Insert AFTER successful dispatch so failed deliveries don't burn the
  // cooldown window. The row is shared shape with patient OTPs — there's
  // no doctor-vs-patient discriminator on otp_verifications; the verify
  // step is what decides which surface authenticates.
  const expiresAtIso = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();
  const { error: insertErr } = await supabaseAdmin.from("otp_verifications").insert({
    phone,
    otp_hash: otpHash,
    channel,
    expires_at: expiresAtIso,
  });
  if (insertErr) {
    console.error("[doctor-send-otp] insert failed after dispatch:", insertErr);
    return NextResponse.json(
      { error: "Code sent, but we couldn't track it. Please request another." },
      { status: 500 },
    );
  }
  console.log("[doctor-send-otp] success", { phone, channel, bypass: bypassDispatch });

  // Opportunistic cleanup.
  void (async () => {
    try {
      await supabaseAdmin.rpc("purge_old_otp_verifications");
    } catch {
      /* best-effort */
    }
  })();

  return NextResponse.json({
    ok: true,
    channel,
    expiresInSeconds: OTP_TTL_SECONDS,
  });
}

function resolveChannel(requested: string): OtpChannel | null {
  // Mirrors /api/auth/send-otp's resolveChannel. Same defaults so doctor
  // and patient OTPs use the same primary provider.
  const defaultChannel = (process.env.OTP_DEFAULT_CHANNEL ?? "rampwin") as OtpChannel;
  const smsEnabled = process.env.SMS_OTP_ENABLED === "true";
  const whatsappEnabled = process.env.WHATSAPP_OTP_ENABLED === "true";
  const rampwinEnabled = process.env.RAMPWIN_OTP_ENABLED === "true";

  if (requested === "rampwin") return rampwinEnabled ? "rampwin" : null;
  if (requested === "sms") return smsEnabled ? "sms" : null;
  if (requested === "whatsapp") return whatsappEnabled ? "whatsapp" : null;

  if (defaultChannel === "rampwin" && rampwinEnabled) return "rampwin";
  if (defaultChannel === "whatsapp" && whatsappEnabled) return "whatsapp";
  if (defaultChannel === "sms" && smsEnabled) return "sms";
  if (rampwinEnabled) return "rampwin";
  if (whatsappEnabled) return "whatsapp";
  if (smsEnabled) return "sms";
  return null;
}
