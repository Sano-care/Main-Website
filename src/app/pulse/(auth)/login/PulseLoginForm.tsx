"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ShieldCheck,
  Phone as PhoneIcon,
  Loader2,
  ArrowRight,
  AlertCircle,
  MessageCircle,
  HeartPulse,
} from "lucide-react";

import { Button } from "@/components/ui";
import { PHONE_DISPLAY } from "@/lib/contact";
import { sanitizeNext } from "../../_lib/safeNext";

// Full-page sign-in for Sanocare Pulse. Mirrors the booking BookingGate OTP
// shape (phone + consent → 6-box OTP) but adds a third "name capture" step
// for first-time numbers and lives on its own route rather than in a modal.
//
// Channel selection mirrors BookingGate exactly — env-flag driven so we can
// flip primary/secondary without code.

const RESEND_COOLDOWN_SECONDS = 30;

type Channel = "whatsapp" | "sms";

const WHATSAPP_ENABLED = process.env.NEXT_PUBLIC_WHATSAPP_OTP_ENABLED === "true";
const SMS_ENABLED = process.env.NEXT_PUBLIC_SMS_OTP_ENABLED === "true";

function pickPrimaryChannel(): Channel {
  const configured = process.env.NEXT_PUBLIC_OTP_DEFAULT_CHANNEL as
    | Channel
    | undefined;
  if (configured === "whatsapp" && WHATSAPP_ENABLED) return "whatsapp";
  if (configured === "sms" && SMS_ENABLED) return "sms";
  if (WHATSAPP_ENABLED) return "whatsapp";
  if (SMS_ENABLED) return "sms";
  return "whatsapp";
}

const PRIMARY_CHANNEL: Channel = pickPrimaryChannel();

const FALLBACK_CHANNEL: Channel | null =
  PRIMARY_CHANNEL === "sms"
    ? WHATSAPP_ENABLED
      ? "whatsapp"
      : null
    : SMS_ENABLED
      ? "sms"
      : null;

const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
};

type Step = "phone" | "otp" | "name";

export function PulseLoginForm({ next }: { next: string }) {
  const safeNext = sanitizeNext(next);

  const [step, setStep] = useState<Step>("phone");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [consent, setConsent] = useState(false);
  const [otp, setOtp] = useState<string[]>(["", "", "", "", "", ""]);
  const [fullName, setFullName] = useState("");
  const [channelUsed, setChannelUsed] = useState<Channel>(PRIMARY_CHANNEL);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCountdown, setResendCountdown] = useState(0);

  const phoneIsValid = useMemo(
    () => /^[6-9]\d{9}$/.test(phoneDigits),
    [phoneDigits],
  );
  const canSendCode = phoneIsValid && consent && !sending;
  const e164 = `+91${phoneDigits}`;

  // Resend countdown tick.
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const t = setTimeout(() => setResendCountdown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCountdown]);

  /** After a verified cookie exists, decide name-capture vs straight in. */
  async function routeAfterVerify() {
    try {
      const res = await fetch("/api/pulse/account", {
        method: "GET",
        credentials: "include",
      });
      const json = (await res.json().catch(() => ({}))) as {
        customer?: { id: string; full_name: string | null } | null;
      };
      if (res.ok && json.customer?.id) {
        // Existing customer — full navigation so the server re-reads the
        // freshly-set cookie.
        window.location.assign(safeNext);
        return;
      }
      // Verified but no customer row yet — capture the name.
      setStep("name");
    } catch (err) {
      console.error("[pulse/login] account lookup failed:", err);
      setError("Network error. Please try again.");
    }
  }

  // ===== Step 1: send OTP =====
  async function handleSendCode(channel: Channel = PRIMARY_CHANNEL) {
    if (!canSendCode && step === "phone") return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone: e164, channel }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        channel?: Channel;
        retryAfterSeconds?: number;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(
          json.error ||
            `We couldn't send the code. Please try again or call ${PHONE_DISPLAY}.`,
        );
        if (json.retryAfterSeconds && json.retryAfterSeconds > 0) {
          setResendCountdown(
            Math.min(json.retryAfterSeconds, RESEND_COOLDOWN_SECONDS),
          );
        }
        return;
      }
      setChannelUsed(json.channel ?? channel);
      setStep("otp");
      setResendCountdown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      console.error("[pulse/login] send-otp failed:", err);
      setError("Network error. Please check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  // ===== Step 2: verify OTP =====
  async function handleVerify() {
    const code = otp.join("");
    if (!/^\d{6}$/.test(code)) {
      setError("Please enter all 6 digits.");
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        // T90 Step 09: explicit stay_signed_in=true matches the server
        // default. The login form deliberately omits a toggle — the
        // welcome page Step 1 surfaces the user's deliberate consent
        // and re-issues the cookie via /api/auth/stay-signed-in-preference
        // if they uncheck it.
        body: JSON.stringify({ phone: e164, otp: code, stay_signed_in: true }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        phone?: string;
        error?: string;
        is_new_customer?: boolean;
      };
      if (!res.ok || !json.ok) {
        setError(json.error || "That code didn't match.");
        return;
      }
      // T90 Step 09: first-Pulse-signin (M047 pulse_first_signin_at was
      // null pre-verify) routes to the welcome onboarding flow instead
      // of safeNext. Full-page navigation so the (onboarding) layout
      // server-reads the fresh cookie.
      if (json.is_new_customer) {
        window.location.assign("/pulse/welcome");
        return;
      }
      await routeAfterVerify();
    } catch (err) {
      console.error("[pulse/login] verify-otp failed:", err);
      setError("Network error. Please try again.");
    } finally {
      setVerifying(false);
    }
  }

  // ===== Step 3: name capture (first-time numbers) =====
  async function handleSaveName() {
    const name = fullName.trim();
    if (name.length < 2) {
      setError("Please enter your name.");
      return;
    }
    setSavingName(true);
    setError(null);
    try {
      const res = await fetch("/api/pulse/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ full_name: name }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        customer?: { id: string };
        error?: string;
      };
      if (!res.ok || !json.customer?.id) {
        setError(json.error || "Could not save your name. Try again.");
        return;
      }
      window.location.assign(safeNext);
    } catch (err) {
      console.error("[pulse/login] save name failed:", err);
      setError("Network error. Please try again.");
    } finally {
      setSavingName(false);
    }
  }

  // ===== OTP box handling =====
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  function handleOtpChange(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    setOtp((prev) => {
      const nextOtp = [...prev];
      nextOtp[index] = digit;
      return nextOtp;
    });
    if (digit && index < 5) otpRefs.current[index + 1]?.focus();
  }
  function handleOtpKeyDown(
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>,
  ) {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  }
  function handleOtpPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const nextOtp = ["", "", "", "", "", ""];
    for (let i = 0; i < pasted.length; i++) nextOtp[i] = pasted[i];
    setOtp(nextOtp);
    otpRefs.current[Math.min(pasted.length, 5)]?.focus();
  }

  const otpFilled = otp.every((d) => d.length === 1);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-100 bg-white/80 backdrop-blur-sm">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-12 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center group" aria-label="Sanocare home">
            {/* T90 Step 08-fold-in 2 (subsumes task #74): canonical Sanocare
                lockup, replacing the prior /logo.svg square icon + hand-
                rolled "Sano(italic)care" wordmark. One asset, one rendition
                — matches the lockup used by the Pulse app bar and drawer. */}
            <Image
              src="/sanocare-lockup.svg"
              alt="Sanocare"
              width={140}
              height={32}
              priority
              className="h-8 w-auto"
            />
          </Link>
          <span className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-primary">
            <HeartPulse className="h-4 w-4" />
            Pulse
          </span>
        </div>
      </header>

      {/* Card */}
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-6 lg:p-8">
          {step === "phone" && (
            <>
              <div className="flex items-center gap-2 text-primary">
                <ShieldCheck className="h-5 w-5" />
                <span className="text-xs font-mono uppercase tracking-widest">
                  Sign in to Pulse
                </span>
              </div>
              <h1 className="mt-2 text-2xl font-bold text-text-main">
                Your health, in one place
              </h1>
              <p className="mt-2 text-sm text-text-secondary">
                We&apos;ll send a 6-digit code by{" "}
                {CHANNEL_LABEL[PRIMARY_CHANNEL]}. Your mobile number is all we
                need — no password to remember.
              </p>

              <label className="mt-6 block text-xs font-bold uppercase tracking-wider text-text-secondary">
                Mobile number
              </label>
              <div className="mt-1.5 flex items-stretch rounded-xl border border-slate-200 bg-white focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 transition-all">
                <span className="flex items-center gap-1.5 border-r border-slate-200 px-3 text-sm font-semibold text-text-main">
                  <PhoneIcon className="h-4 w-4 text-text-secondary" />
                  +91
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  pattern="[6-9][0-9]{9}"
                  maxLength={10}
                  placeholder="98765 43210"
                  value={phoneDigits}
                  onChange={(e) =>
                    setPhoneDigits(
                      e.target.value.replace(/\D/g, "").slice(0, 10),
                    )
                  }
                  className="flex-1 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-slate-400"
                />
              </div>

              <label className="mt-5 flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                />
                <span className="text-xs leading-relaxed text-text-secondary">
                  I agree to receive a one-time verification code from Sanocare
                  on this number, and to Sanocare processing my data per the{" "}
                  <a
                    href="/privacy"
                    className="text-primary hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Privacy Policy
                  </a>
                  .
                </span>
              </label>

              {error && <ErrorBox message={error} />}

              <Button
                type="button"
                variant="primary"
                size="lg"
                className="mt-5 w-full"
                disabled={!canSendCode}
                onClick={() => handleSendCode(PRIMARY_CHANNEL)}
              >
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    Send code on {CHANNEL_LABEL[PRIMARY_CHANNEL]}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
              <p className="mt-3 text-center text-xs text-text-secondary">
                Need help? Call us at {PHONE_DISPLAY}.
              </p>
            </>
          )}

          {step === "otp" && (
            <>
              <div className="flex items-center gap-2 text-primary">
                <MessageCircle className="h-5 w-5" />
                <span className="text-xs font-mono uppercase tracking-widest">
                  {CHANNEL_LABEL[channelUsed]} code sent
                </span>
              </div>
              <h1 className="mt-2 text-2xl font-bold text-text-main">
                Enter the 6-digit code
              </h1>
              <p className="mt-2 text-sm text-text-secondary">
                Sent to{" "}
                <span className="font-semibold text-text-main">
                  {e164.replace(/^(\+91)(\d{5})(\d{5})$/, "$1 $2 $3")}
                </span>
                .{" "}
                <button
                  type="button"
                  onClick={() => {
                    setStep("phone");
                    setError(null);
                  }}
                  className="text-primary hover:underline"
                >
                  Edit
                </button>
              </p>

              <div
                className="mt-6 flex justify-center gap-2"
                onPaste={handleOtpPaste}
              >
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      otpRefs.current[i] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    autoComplete={i === 0 ? "one-time-code" : "off"}
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    className="h-12 w-10 rounded-xl border border-slate-200 bg-white text-center text-lg font-semibold text-text-main outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all"
                  />
                ))}
              </div>

              {error && <ErrorBox message={error} />}

              <Button
                type="button"
                variant="primary"
                size="lg"
                className="mt-5 w-full"
                disabled={!otpFilled || verifying}
                onClick={handleVerify}
              >
                {verifying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying…
                  </>
                ) : (
                  <>
                    Verify and continue
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>

              <div className="mt-4 text-center text-xs text-text-secondary">
                {resendCountdown > 0 ? (
                  <span>You can request a new code in {resendCountdown}s</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSendCode(PRIMARY_CHANNEL)}
                    disabled={sending}
                    className="text-primary hover:underline disabled:opacity-50"
                  >
                    Resend code on {CHANNEL_LABEL[PRIMARY_CHANNEL]}
                  </button>
                )}
              </div>

              {FALLBACK_CHANNEL && (
                <div className="mt-2 text-center text-xs text-text-secondary">
                  Didn&apos;t get it on {CHANNEL_LABEL[channelUsed]}?{" "}
                  <button
                    type="button"
                    onClick={() => handleSendCode(FALLBACK_CHANNEL)}
                    disabled={sending || resendCountdown > 0}
                    className="text-primary hover:underline disabled:opacity-50"
                  >
                    Send via {CHANNEL_LABEL[FALLBACK_CHANNEL]} instead
                  </button>
                </div>
              )}
            </>
          )}

          {step === "name" && (
            <>
              <div className="flex items-center gap-2 text-primary">
                <HeartPulse className="h-5 w-5" />
                <span className="text-xs font-mono uppercase tracking-widest">
                  One last step
                </span>
              </div>
              <h1 className="mt-2 text-2xl font-bold text-text-main">
                What should we call you?
              </h1>
              <p className="mt-2 text-sm text-text-secondary">
                Your number is verified. Add your name and we&apos;ll set up
                your Pulse.
              </p>

              <label className="mt-6 block text-xs font-bold uppercase tracking-wider text-text-secondary">
                Full name
              </label>
              <input
                type="text"
                autoComplete="name"
                placeholder="e.g. Priya Sharma"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && fullName.trim().length >= 2) {
                    handleSaveName();
                  }
                }}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-text-main outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all placeholder:text-slate-400"
              />

              {error && <ErrorBox message={error} />}

              <Button
                type="button"
                variant="primary"
                size="lg"
                className="mt-5 w-full"
                disabled={fullName.trim().length < 2 || savingName}
                onClick={handleSaveName}
              >
                {savingName ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Setting up…
                  </>
                ) : (
                  <>
                    Enter Pulse
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
