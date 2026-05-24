"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Phone,
  KeyRound,
  Loader2,
  AlertCircle,
  Shield,
  ArrowLeft,
  Info,
} from "lucide-react";

type Step = "phone" | "otp";

// Mirrors the patient OTP flow: send first, then verify with the 6-digit
// code. We hold a 30-second cooldown locally so "Resend code" is gated
// without an extra round-trip; the server also enforces it.
const RESEND_COOLDOWN_SECONDS = 30;

export function DoctorLoginForm({
  initialReason,
}: {
  initialReason: "inactive" | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(
    initialReason === "inactive"
      ? "Your previous session has expired or your account was deactivated. Please sign in again."
      : null,
  );
  const [resendIn, setResendIn] = useState(0);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const otpInputRef = useRef<HTMLInputElement | null>(null);

  // Countdown tick for the resend cooldown.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // Focus the OTP input once we land on step 2.
  useEffect(() => {
    if (step === "otp") otpInputRef.current?.focus();
  }, [step]);

  const handleSendOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setInfo(null);
    setIsLoading(true);
    try {
      const res = await fetch("/api/doctor/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, channel: "auto" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Could not send code. Please try again.");
        if (typeof data?.retryAfterSeconds === "number") {
          setResendIn(data.retryAfterSeconds);
        }
        return;
      }
      setStep("otp");
      setOtp("");
      setAttemptsRemaining(null);
      setResendIn(RESEND_COOLDOWN_SECONDS);
      setInfo("We sent a 6-digit code on WhatsApp. It expires in 5 minutes.");
    } catch (err) {
      console.error("[doctor-login] send-otp error", err);
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setIsLoading(true);
    try {
      const res = await fetch("/api/doctor/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, otp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "That code didn't match.");
        if (typeof data?.attemptsRemaining === "number") {
          setAttemptsRemaining(data.attemptsRemaining);
        }
        return;
      }
      // Cookie was set on the response; navigate into the portal. A hard
      // replace ensures the (shell) layout sees the fresh cookie.
      router.replace("/doctor");
      router.refresh();
    } catch (err) {
      console.error("[doctor-login] verify-otp error", err);
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = () => {
    if (resendIn > 0 || isLoading) return;
    void handleSendOtp();
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md"
      >
        <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl p-8 shadow-2xl">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <div className="relative">
                <Image
                  src="/logo.svg"
                  alt="Sanocare"
                  width={48}
                  height={48}
                  className="w-12 h-12"
                />
                <div className="absolute -bottom-1 -right-1 bg-primary rounded-full p-1">
                  <Shield className="w-3 h-3 text-white" />
                </div>
              </div>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Doctor sign-in</h1>
            <p className="text-slate-400 text-sm">
              {step === "phone"
                ? "Enter your registered mobile number to get a one-time code."
                : "Enter the 6-digit code we sent on WhatsApp."}
            </p>
          </div>

          {/* Info banner */}
          {info && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2 text-sky-300 text-sm bg-sky-500/10 border border-sky-500/20 rounded-lg p-3 mb-4"
            >
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{info}</span>
            </motion.div>
          )}

          {/* Error banner */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <div>{error}</div>
                {attemptsRemaining != null && attemptsRemaining > 0 && (
                  <div className="text-xs text-red-300 mt-0.5">
                    {attemptsRemaining} attempt{attemptsRemaining === 1 ? "" : "s"} remaining.
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {step === "phone" ? (
            <form onSubmit={handleSendOtp} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Mobile number
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="10-digit Indian mobile"
                    required
                    className="w-full bg-slate-900/50 border border-slate-600 rounded-xl py-3 pl-11 pr-4 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Must match the number ops has on file. If it doesn&apos;t work, contact ops.
                </p>
              </div>

              <button
                type="submit"
                disabled={isLoading || !phone.trim()}
                className="w-full bg-primary hover:bg-primary-dark text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Sending code…
                  </>
                ) : (
                  "Send code"
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerify} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  6-digit code
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <input
                    ref={otpInputRef}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="••••••"
                    required
                    className="w-full bg-slate-900/50 border border-slate-600 rounded-xl py-3 pl-11 pr-4 text-white placeholder:text-slate-600 tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                  />
                </div>
                <div className="flex items-center justify-between mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStep("phone");
                      setOtp("");
                      setError(null);
                      setInfo(null);
                      setAttemptsRemaining(null);
                    }}
                    disabled={isLoading}
                    className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50"
                  >
                    <ArrowLeft className="w-3 h-3" /> Change number
                  </button>
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resendIn > 0 || isLoading}
                    className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50"
                  >
                    {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading || otp.length !== 6}
                className="w-full bg-primary hover:bg-primary-dark text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Verifying…
                  </>
                ) : (
                  "Verify & sign in"
                )}
              </button>
            </form>
          )}

          {/* Footer */}
          <div className="mt-6 pt-6 border-t border-slate-700 text-center">
            <p className="text-xs text-slate-500">
              Sanocare doctor portal. Sessions expire after 8 hours.
            </p>
          </div>
        </div>

        <div className="text-center mt-4">
          <span className="text-xs text-slate-600">Sanocare Doctor v1.0</span>
        </div>
      </motion.div>
    </div>
  );
}
