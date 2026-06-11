"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check } from "lucide-react";

/**
 * T90 Pulse v1 Phase 1 — Welcome Step 1 client.
 *
 * Owns the input + checkbox state and the POST to
 * /api/auth/stay-signed-in-preference. The parent server page passes
 * `initialName` from customers.full_name so an already-named user
 * (e.g., a booking-only customer Pulse-signing for the first time)
 * sees a pre-filled input and just taps Continue.
 *
 * Copy (brief + patch 1, 2026-06-12):
 *   Headline:    You're in. (large, primary blue)
 *   Name label:  What should we call you?
 *   Name input:  placeholder "Your full name", required ≥2 chars
 *   Checkbox:    Stay signed in on this phone (default checked)
 *   Helper:      We won't ask for your number again. You can sign out
 *                anytime from the menu.
 *   CTA:         Continue → (disabled until name has ≥2 non-whitespace chars)
 *
 * Validation: client-side ≥2 trimmed chars gates the CTA. Server-side
 * the API route uses `validatePatientName` (the same rules as the
 * booking flow — rejects 'patient'/'user'/'test'/'name' placeholders
 * + length 2–80). A server-rejection surfaces as an inline error
 * banner; the user fixes the name and retries.
 *
 * On Continue success:
 *   - Server PATCHes customers.full_name (if provided) and re-issues
 *     the OTP-verify cookie with the chosen Max-Age.
 *   - Client routes to /pulse/welcome/family.
 *
 * Soft-fail policy: a network error on the POST surfaces an inline
 * banner. We do NOT proceed silently — the founder direction is that
 * the name capture is meaningful enough to warrant a retry.
 */

interface Props {
  initialName: string;
}

export default function WelcomeStep1Client({ initialName }: Props) {
  const router = useRouter();
  const [fullName, setFullName] = useState(initialName);
  const [staySignedIn, setStaySignedIn] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canContinue = fullName.trim().length >= 2 && !submitting;

  async function handleContinue() {
    if (!canContinue) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/stay-signed-in-preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          stay_signed_in: staySignedIn,
          full_name: fullName.trim(),
        }),
      });
      if (!res.ok) {
        // 400 = validation; 401 = session expired; everything else =
        // server error. The route returns { error } JSON for all of these.
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(
          json.error ||
            "Could not save right now. Please check your connection and try again.",
        );
        setSubmitting(false);
        return;
      }
      // 204 No Content — cookie re-set + name PATCHed. Proceed to Step 2.
      router.push("/pulse/welcome/family");
    } catch (err) {
      console.error("[welcome] stay-signed-in preference POST failed", err);
      setError(
        "Could not save right now. Please check your connection and try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-5 py-8">
      {/* Lockup header — small, link to /pulse home. */}
      <header className="mx-auto max-w-md">
        <Link
          href="/pulse"
          aria-label="Sanocare Pulse home"
          className="inline-flex"
        >
          <Image
            src="/sanocare-lockup.svg"
            alt="Sanocare"
            width={120}
            height={28}
            priority
            className="h-7 w-auto"
          />
        </Link>
      </header>

      {/* Card */}
      <main className="mx-auto mt-10 w-full max-w-md rounded-3xl bg-white p-8 shadow-xl">
        {/* Hero check icon */}
        <div className="flex justify-center">
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary-50 text-primary">
            <Check className="h-8 w-8" strokeWidth={3} aria-hidden="true" />
          </span>
        </div>

        <h1 className="mt-6 text-center text-3xl font-bold tracking-tight text-primary">
          You&apos;re in.
        </h1>

        {/* Name input */}
        <label className="mt-8 block">
          <span className="block text-xs font-bold uppercase tracking-wider text-text-secondary">
            What should we call you?
          </span>
          <input
            type="text"
            autoFocus={!initialName}
            placeholder="Your full name"
            value={fullName}
            maxLength={80}
            onChange={(e) => setFullName(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-text-main outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
          />
        </label>

        {/* Checkbox + helper */}
        <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:border-primary/40">
          <input
            type="checkbox"
            checked={staySignedIn}
            onChange={(e) => setStaySignedIn(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-slate-300 text-primary focus:ring-2 focus:ring-primary/20"
          />
          <span className="flex-1">
            <span className="block text-sm font-semibold text-text-main">
              Stay signed in on this phone
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-text-secondary">
              We won&apos;t ask for your number again. You can sign out anytime
              from the menu.
            </span>
          </span>
        </label>

        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700"
          >
            {error}
          </div>
        ) : null}

        {/* CTA */}
        <button
          type="button"
          onClick={handleContinue}
          disabled={!canContinue}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? "Saving…" : "Continue →"}
        </button>
      </main>
    </div>
  );
}
