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
    console.log("[send-otp] rejected: invalid phone input");
    return NextResponse.json(
      { error: "Please enter a valid 10-digit Indian mobile number." },
      { status: 400 },
    );
  }

  const requested = String(body.channel ?? "auto").toLowerCase();
  const bypassDispatch = process.env.OTP_DEV_BYPASS === "true";

  // Entry-level diagnostic so every invocation produces a discoverable log
  // line. Phone is logged in E.164 (we just normalised it); OTP itself is
  // not logged here (only on the bypass branch).
  console.log("[send-otp] entered", {
    phone,
    requested,
    OTP_DEV_BYPASS: process.env.OTP_DEV_BYPASS ?? "(unset)",
    OTP_DEFAULT_CHANNEL: process.env.OTP_DEFAULT_CHANNEL ?? "(unset)",
    SMS_OTP_ENABLED: process.env.SMS_OTP_ENABLED ?? "(unset)",
    WHATSAPP_OTP_ENABLED: process.env.WHATSAPP_OTP_ENABLED ?? "(unset)",
    bypassDispatch,
  });

  // Resolve which channel string to STORE in otp_verifications.channel
  // (the column has a CHECK constraint allowing only 'whatsapp' or 'sms').
  // When bypass is on we skip the enable-flag check because no provider is
  // about to be called; the channel value is purely for the row.
  const channel: OtpChannel | null = bypassDispatch
    ? requested === "whatsapp"
      ? "whatsapp"
      : "sms"
    : resolveChannel(requested);
  if (!channel) {
    console.log("[send-otp] rejected: no usable channel", { requested });
    return NextResponse.json(
      {
        error:
          requested === "sms"
            ? "SMS is not available right now. Please try WhatsApp or call +91-9711977782."
            : requested === "whatsapp"
              ? "WhatsApp OTP is temporarily unavailable. Please try SMS or call +91-9711977782."
              : "OTP delivery is temporarily unavailable. Please call +91-9711977782 to book.",
      },
      { status: 400 },
    );
  }
  console.log("[send-otp] channel resolved", { channel });

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
    console.log("[send-otp] rate-limit hit", { phone, sendsInLastHour: recent.length });
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
      console.log("[send-otp] cooldown hit", { phone, elapsedSeconds: Math.round(elapsed) });
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

  // === Dev bypass vs provider dispatch ===
  // The bypass flag was resolved at the top of the route. When on, we log
  // the code and skip the provider call entirely. When off, we hand off to
  // the configured channel sender.
  if (bypassDispatch) {
    console.warn(
      `[send-otp] ⚠️  OTP_DEV_BYPASS active — code for ${phone} is ${code}. Provider dispatch SKIPPED. Disable this flag before going live.`,
    );
  } else {
    console.log("[send-otp] dispatching via provider", { channel });
    try {
      await sendOtp({ phone, code, channel });
      console.log("[send-otp] dispatch ok", { channel });
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
  console.log("[send-otp] success", { phone, channel, bypass: bypassDispatch });

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
  // Each channel is independently flagged so we can flip primary/secondary
  // without touching code. While the WhatsApp WABA is restricted, set
  // WHATSAPP_OTP_ENABLED=false so the channel is rejected even if a stale
  // client asks for it. SMS is currently primary until the WABA clears.
  const defaultChannel = (process.env.OTP_DEFAULT_CHANNEL ?? "sms") as OtpChannel;
  const smsEnabled = process.env.SMS_OTP_ENABLED === "true";
  const whatsappEnabled = process.env.WHATSAPP_OTP_ENABLED !== "false";

  if (requested === "sms") {
    return smsEnabled ? "sms" : null;
  }
  if (requested === "whatsapp") {
    return whatsappEnabled ? "whatsapp" : null;
  }
  // 'auto' — prefer the configured default if it's enabled, else fall back
  // to whichever channel is enabled. Returns null if neither is enabled
  // (caller surfaces a 400 with a useful message).
  if (defaultChannel === "sms" && smsEnabled) return "sms";
  if (defaultChannel === "whatsapp" && whatsappEnabled) return "whatsapp";
  if (smsEnabled) return "sms";
  if (whatsappEnabled) return "whatsapp";
  return null;
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
