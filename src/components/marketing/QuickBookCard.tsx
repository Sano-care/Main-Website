"use client";

// Homepage Quick Book card. 2 fields (name + phone) → POST to
// /api/callback-request → inline success state. Replaces the hero
// 5-field form per T61.
//
// Success state copy (founder-approved):
//   "Thanks {firstName} — we'll call you on {phone} within 15 minutes"
//   + "Book another visit" reset link
//
// The card does NOT navigate after success — the patient stays on
// the page so they can browse other entry points (sticky CTA, service
// cards, etc.). Reset link clears state and returns to the form.

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, CheckCircle2, AlertCircle, Phone } from "lucide-react";

type Status = "idle" | "submitting" | "success" | "error";

const PHONE_PREFIX = "+91 ";
const PHONE_DISPLAY = "+91 97119 77782";
const PHONE_TEL = "+919711977782";

export function QuickBookCard() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  // Snapshot of what we submitted, used in the success message so the
  // reset doesn't blank the values mid-read.
  const [submitted, setSubmitted] = useState<{ name: string; phone: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "submitting") return;

    setStatus("submitting");
    setErrorMessage("");

    try {
      const res = await fetch("/api/callback-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setStatus("error");
        setErrorMessage(data.error ?? "Couldn't send your request. Please try again.");
        return;
      }
      setSubmitted({ name: name.trim(), phone: phone.trim() });
      setStatus("success");
    } catch {
      setStatus("error");
      setErrorMessage("Network error. Please try again.");
    }
  };

  const handleReset = () => {
    setName("");
    setPhone("");
    setStatus("idle");
    setErrorMessage("");
    setSubmitted(null);
  };

  const firstName = submitted?.name.split(/\s+/)[0] ?? "";
  const displayPhone = submitted?.phone.startsWith("+91")
    ? submitted.phone
    : `+91 ${submitted?.phone ?? ""}`;

  return (
    <div
      id="quick-book"
      className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm max-w-md mx-auto"
    >
      <div className="text-[11px] font-mono uppercase tracking-wider text-sky-600 mb-1">
        Quick book
      </div>
      <h2 className="text-xl font-bold text-slate-900 mb-4">
        Get a callback in 15 minutes
      </h2>

      <AnimatePresence mode="wait" initial={false}>
        {status === "success" && submitted ? (
          <motion.div
            key="success"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col items-start gap-3"
          >
            <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-emerald-800 text-sm w-full">
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                Thanks {firstName} — we&apos;ll call you on{" "}
                <span className="font-semibold">{displayPhone}</span> within
                15 minutes.
              </div>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="text-sm text-sky-700 hover:text-sky-900 underline decoration-sky-200 hover:decoration-sky-700"
            >
              Book another visit
            </button>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onSubmit={handleSubmit}
            className="space-y-3"
            noValidate
          >
            <div>
              <label
                htmlFor="qbc-name"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Your name
              </label>
              <input
                id="qbc-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={100}
                autoComplete="name"
                disabled={status === "submitting"}
                className="w-full px-3 py-3 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent disabled:bg-slate-50"
              />
            </div>
            <div>
              <label
                htmlFor="qbc-phone"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Mobile number
              </label>
              <div className="flex items-stretch">
                <span className="inline-flex items-center px-3 bg-slate-100 border border-r-0 border-slate-300 rounded-l-lg text-base text-slate-700">
                  {PHONE_PREFIX}
                </span>
                <input
                  id="qbc-phone"
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  placeholder="9711977782"
                  autoComplete="tel-national"
                  disabled={status === "submitting"}
                  className="flex-1 min-w-0 px-3 py-3 border border-slate-300 rounded-r-lg text-base focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent disabled:bg-slate-50"
                />
              </div>
            </div>

            {status === "error" && (
              <div className="flex items-start gap-2 text-rose-700 text-sm bg-rose-50 border border-rose-200 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{errorMessage}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={status === "submitting" || !name.trim() || !phone.trim()}
              className="w-full inline-flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors active:scale-[0.97]"
            >
              {status === "submitting" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  Sending…
                </>
              ) : (
                <>Get a callback →</>
              )}
            </button>

            <div className="text-center text-xs text-slate-500 pt-1">
              Or call us directly{" "}
              <a
                href={`tel:${PHONE_TEL}`}
                className="inline-flex items-center gap-1 text-sky-700 hover:text-sky-900 font-medium"
              >
                <Phone className="w-3 h-3" aria-hidden="true" />
                {PHONE_DISPLAY}
              </a>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
