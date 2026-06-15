"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, X, Phone as PhoneIcon, Loader2, ArrowRight, AlertCircle, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui";
import { useBookingStore } from "@/store/bookingStore";
import { useScrollLock } from "@/hooks/useScrollLock";
import { PHONE_DISPLAY } from "@/lib/contact";

// Keep in sync with token.ts. Duplicated here so the gate doesn't need to
// import a server-only module.
const TOKEN_TTL_MS = 30 * 60 * 1000;
const RESEND_COOLDOWN_SECONDS = 30;

type Channel = "whatsapp" | "sms" | "rampwin";

// Channel availability is driven entirely by env flags so we can flip
// primary/secondary without code changes:
//   NEXT_PUBLIC_OTP_DEFAULT_CHANNEL    — "rampwin" (current), "whatsapp", or "sms"
//   NEXT_PUBLIC_RAMPWIN_OTP_ENABLED    — "true" to allow Rampwin-routed WhatsApp
//   NEXT_PUBLIC_WHATSAPP_OTP_ENABLED   — "true" to allow Meta-direct WhatsApp
//   NEXT_PUBLIC_SMS_OTP_ENABLED        — "true" to allow MSG91 SMS
//
// Rampwin and Meta-direct both deliver a WhatsApp message to the patient —
// the patient never sees the provider name; CHANNEL_LABEL below maps both
// to "WhatsApp". The distinction matters only for which BSP signs the
// delivery (Meta direct stays available as a manual fallback while
// Rampwin is the new default).
const RAMPWIN_ENABLED =
  process.env.NEXT_PUBLIC_RAMPWIN_OTP_ENABLED === "true";
const WHATSAPP_ENABLED =
  process.env.NEXT_PUBLIC_WHATSAPP_OTP_ENABLED === "true";
const SMS_ENABLED = process.env.NEXT_PUBLIC_SMS_OTP_ENABLED === "true";

function pickPrimaryChannel(): Channel {
  const configured = process.env.NEXT_PUBLIC_OTP_DEFAULT_CHANNEL as
    | Channel
    | undefined;
  if (configured === "rampwin" && RAMPWIN_ENABLED) return "rampwin";
  if (configured === "whatsapp" && WHATSAPP_ENABLED) return "whatsapp";
  if (configured === "sms" && SMS_ENABLED) return "sms";
  // Fall-through priority: rampwin > whatsapp > sms. The market is
  // WhatsApp-heavy and the template message renders better than SMS.
  if (RAMPWIN_ENABLED) return "rampwin";
  if (WHATSAPP_ENABLED) return "whatsapp";
  if (SMS_ENABLED) return "sms";
  // No flag is set in env — fall back to "rampwin" so the UI still
  // renders sensibly. The server's send-otp route will return an
  // explanatory error if no channel is actually configured.
  return "rampwin";
}

const PRIMARY_CHANNEL: Channel = pickPrimaryChannel();

// Fallback offered as a one-click link beneath the "send code" button.
// Both Rampwin and Meta-direct ultimately deliver a WhatsApp message, so
// when the primary IS already WhatsApp (rampwin or whatsapp) the only
// useful cross-modal fallback is SMS. When the primary is SMS, the
// fallback is whichever WhatsApp provider is enabled.
const FALLBACK_CHANNEL: Channel | null =
  PRIMARY_CHANNEL === "sms"
    ? RAMPWIN_ENABLED
      ? "rampwin"
      : WHATSAPP_ENABLED
        ? "whatsapp"
        : null
    : SMS_ENABLED
      ? "sms"
      : null;

const CHANNEL_LABEL: Record<Channel, string> = {
  // Patients never see "Rampwin" — they get a WhatsApp message either way.
  rampwin: "WhatsApp",
  whatsapp: "WhatsApp",
  sms: "SMS",
};

interface BookingGateProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Fired after the OTP cookie is set + the bookingStore is updated. Caller
   * decides what to do next — typically open the booking form modal or
   * resume the inline submit. The verified phone (E.164) is passed back so
   * the caller can prefill / lock the phone field.
   */
  onVerified: (phone: string) => void;
}

type Step = "phone" | "otp";

export function BookingGate({ isOpen, onClose, onVerified }: BookingGateProps) {
  const setPhoneVerified = useBookingStore((s) => s.setPhoneVerified);
  const setDetails = useBookingStore((s) => s.setDetails);

  // T85 PR4a bug 2 fix — body scroll lock. Shared ref-counted hook
  // means the gate→modal handoff (gate releases at the same instant
  // the modal acquires) is glitch-free.
  useScrollLock(isOpen);

  const [step, setStep] = useState<Step>("phone");
  const [phoneDigits, setPhoneDigits] = useState(""); // 10 local digits only
  const [consent, setConsent] = useState(false);
  const [otp, setOtp] = useState<string[]>(["", "", "", "", "", ""]);
  const [channelUsed, setChannelUsed] = useState<Channel>(PRIMARY_CHANNEL);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCountdown, setResendCountdown] = useState(0);

  // Reset gate state every time it (re)opens — no stale countdown or partial OTP.
  useEffect(() => {
    if (!isOpen) return;
    setStep("phone");
    setPhoneDigits("");
    setConsent(false);
    setOtp(["", "", "", "", "", ""]);
    setError(null);
    setResendCountdown(0);
  }, [isOpen]);

  // Resend countdown tick
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const t = setTimeout(() => setResendCountdown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCountdown]);

  const phoneIsValid = useMemo(() => /^[6-9]\d{9}$/.test(phoneDigits), [phoneDigits]);
  const canSendCode = phoneIsValid && consent && !sending;
  const e164 = `+91${phoneDigits}`;

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
          setResendCountdown(Math.min(json.retryAfterSeconds, RESEND_COOLDOWN_SECONDS));
        }
        return;
      }
      setChannelUsed(json.channel ?? channel);
      setStep("otp");
      setResendCountdown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      console.error("[BookingGate] send-otp failed:", err);
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
        body: JSON.stringify({ phone: e164, otp: code }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        phone?: string;
        // T64: verify-otp now also returns the resolved customers row
        // identity (auto-upserted for fresh phones; null full_name when
        // no name has ever been captured).
        customer_id?: string | null;
        full_name?: string | null;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error || "That code didn't match.");
        return;
      }
      const verifiedPhone = json.phone ?? e164;
      const untilMs = Date.now() + TOKEN_TTL_MS;
      // T64: pass full_name through so IdentifyStep + LabBasketWindow can
      // pre-fill their name input for returning patients. null is the
      // explicit "no name yet" signal (vs. undefined which would preserve
      // a stale value from a previous session).
      const verifiedFullName = json.full_name ?? null;
      setPhoneVerified(verifiedPhone, untilMs, verifiedFullName);
      // Mirror the verified phone into the booking form's phone field so
      // the next step renders with phone pre-filled and locked.
      setDetails({ phone: formatPhoneForDisplay(verifiedPhone) });
      onVerified(verifiedPhone);
    } catch (err) {
      console.error("[BookingGate] verify-otp failed:", err);
      setError("Network error. Please try again.");
    } finally {
      setVerifying(false);
    }
  }

  // ===== OTP input box handling =====
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  function handleOtpChange(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    setOtp((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (digit && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  }
  function handleOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  }
  function handleOtpPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const next = ["", "", "", "", "", ""];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setOtp(next);
    otpRefs.current[Math.min(pasted.length, 5)]?.focus();
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Panel */}
          <motion.div
            className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl"
            initial={{ scale: 0.96, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 12 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-gate-title"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-3 top-3 rounded-md p-1 text-text-secondary transition-colors hover:bg-slate-100 hover:text-text-main"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="p-6 lg:p-8">
              {step === "phone" ? (
                <PhoneStep
                  phoneDigits={phoneDigits}
                  onPhoneChange={(v) => setPhoneDigits(v.replace(/\D/g, "").slice(0, 10))}
                  consent={consent}
                  onConsentChange={setConsent}
                  canSend={canSendCode}
                  sending={sending}
                  error={error}
                  onSend={() => handleSendCode(PRIMARY_CHANNEL)}
                />
              ) : (
                <OtpStep
                  phoneE164={e164}
                  otp={otp}
                  channelUsed={channelUsed}
                  resendCountdown={resendCountdown}
                  sending={sending}
                  verifying={verifying}
                  error={error}
                  otpRefs={otpRefs}
                  onChange={handleOtpChange}
                  onKeyDown={handleOtpKeyDown}
                  onPaste={handleOtpPaste}
                  onVerify={handleVerify}
                  onResendPrimary={() => handleSendCode(PRIMARY_CHANNEL)}
                  onResendFallback={
                    FALLBACK_CHANNEL
                      ? () => handleSendCode(FALLBACK_CHANNEL)
                      : null
                  }
                  onEditPhone={() => setStep("phone")}
                />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// =====================================================================
// Sub-components
// =====================================================================

interface PhoneStepProps {
  phoneDigits: string;
  onPhoneChange: (v: string) => void;
  consent: boolean;
  onConsentChange: (v: boolean) => void;
  canSend: boolean;
  sending: boolean;
  error: string | null;
  onSend: () => void;
}

function PhoneStep({
  phoneDigits,
  onPhoneChange,
  consent,
  onConsentChange,
  canSend,
  sending,
  error,
  onSend,
}: PhoneStepProps) {
  return (
    <>
      <div className="flex items-center gap-2 text-primary">
        <ShieldCheck className="h-5 w-5" />
        <span className="text-xs font-mono uppercase tracking-widest">
          Verify to continue
        </span>
      </div>
      <h2
        id="booking-gate-title"
        className="mt-2 text-2xl font-bold text-text-main"
      >
        Confirm your number
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        We&apos;ll send a 6-digit code by {CHANNEL_LABEL[PRIMARY_CHANNEL]} so
        we can reach you about this visit. Your number is the only thing we
        need to get started.
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
          onChange={(e) => onPhoneChange(e.target.value)}
          className="flex-1 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-slate-400"
        />
      </div>

      <label className="mt-5 flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => onConsentChange(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
        />
        <span className="text-xs leading-relaxed text-text-secondary">
          I agree to receive a one-time verification code from Sanocare on this
          number, and to Sanocare processing my data per the{" "}
          <a href="/privacy" className="text-primary hover:underline" target="_blank" rel="noreferrer">
            Privacy Policy
          </a>
          .
        </span>
      </label>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button
        type="button"
        variant="primary"
        size="lg"
        className="mt-5 w-full"
        disabled={!canSend}
        onClick={onSend}
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
        {FALLBACK_CHANNEL ? (
          <>
            Don&apos;t use {CHANNEL_LABEL[PRIMARY_CHANNEL]}? You can switch to{" "}
            {CHANNEL_LABEL[FALLBACK_CHANNEL]} on the next step.
          </>
        ) : (
          <>Need help? Call us at {PHONE_DISPLAY} to book.</>
        )}
      </p>
    </>
  );
}

interface OtpStepProps {
  phoneE164: string;
  otp: string[];
  channelUsed: Channel;
  resendCountdown: number;
  sending: boolean;
  verifying: boolean;
  error: string | null;
  otpRefs: React.MutableRefObject<Array<HTMLInputElement | null>>;
  onChange: (i: number, v: string) => void;
  onKeyDown: (i: number, e: React.KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  onVerify: () => void;
  onResendPrimary: () => void;
  onResendFallback: (() => void) | null;
  onEditPhone: () => void;
}

function OtpStep({
  phoneE164,
  otp,
  channelUsed,
  resendCountdown,
  sending,
  verifying,
  error,
  otpRefs,
  onChange,
  onKeyDown,
  onPaste,
  onVerify,
  onResendPrimary,
  onResendFallback,
  onEditPhone,
}: OtpStepProps) {
  const filled = otp.every((d) => d.length === 1);
  const channelLabel = CHANNEL_LABEL[channelUsed];

  return (
    <>
      <div className="flex items-center gap-2 text-primary">
        <MessageCircle className="h-5 w-5" />
        <span className="text-xs font-mono uppercase tracking-widest">
          {channelLabel} code sent
        </span>
      </div>
      <h2 id="booking-gate-title" className="mt-2 text-2xl font-bold text-text-main">
        Enter the 6-digit code
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        Sent to <span className="font-semibold text-text-main">{phoneE164.replace(/^(\+91)(\d{5})(\d{5})$/, "$1 $2 $3")}</span>.{" "}
        <button
          type="button"
          onClick={onEditPhone}
          className="text-primary hover:underline"
        >
          Edit
        </button>
      </p>

      <div className="mt-6 flex justify-center gap-2" onPaste={onPaste}>
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
            onChange={(e) => onChange(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            className="h-12 w-10 rounded-xl border border-slate-200 bg-white text-center text-lg font-semibold text-text-main outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all"
          />
        ))}
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button
        type="button"
        variant="primary"
        size="lg"
        className="mt-5 w-full"
        disabled={!filled || verifying}
        onClick={onVerify}
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
            onClick={onResendPrimary}
            disabled={sending}
            className="text-primary hover:underline disabled:opacity-50"
          >
            Resend code on {CHANNEL_LABEL[PRIMARY_CHANNEL]}
          </button>
        )}
      </div>

      {onResendFallback && FALLBACK_CHANNEL && (
        <div className="mt-2 text-center text-xs text-text-secondary">
          Didn&apos;t get it on {channelLabel}?{" "}
          <button
            type="button"
            onClick={onResendFallback}
            disabled={sending || resendCountdown > 0}
            className="text-primary hover:underline disabled:opacity-50"
          >
            Send via {CHANNEL_LABEL[FALLBACK_CHANNEL]} instead
          </button>
        </div>
      )}
    </>
  );
}

function formatPhoneForDisplay(e164: string): string {
  // "+919711977782" → "+91 9711977782" — matches the bookingStore's
  // initial "+91 " formatted prefix.
  const digits = e164.replace(/[^\d]/g, "");
  if (digits.startsWith("91") && digits.length === 12) {
    return `+91 ${digits.slice(2)}`;
  }
  return e164;
}
