"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check } from "lucide-react";

/**
 * T90 Pulse v1 Phase 1 — Welcome Step 1 (Surface 1 of brief).
 *
 * Copy 100% locked (brief copy spec):
 *   Headline:  ✓ You're in. (large, primary blue)
 *   Checkbox:  Stay signed in on this phone (default checked)
 *   Helper:    We won't ask for your number again. You can sign out
 *              anytime from the menu.
 *   CTA:       Continue →  (routes to /pulse/welcome/family)
 *
 * On Continue: POST /api/auth/stay-signed-in-preference with the
 * checkbox state — the server re-issues the OTP-verify cookie with
 * the chosen Max-Age (persistent 1-year vs session). Soft-fail on
 * network error; the user proceeds to Step 2 either way. The default
 * checked state matches the server-default from /api/auth/verify-otp,
 * so a no-touch user has a consistent persistent session without
 * needing the POST to succeed.
 *
 * DPDP note: this checkbox IS the deliberate consent surface for the
 * persistent identifier. The server defaults to persistent during
 * OTP-verify (so the user doesn't sign back in mid-flow if this POST
 * fails), but this page is the explicit user-consent moment.
 */

export default function PulseWelcomeStep1Page() {
  const router = useRouter();
  const [staySignedIn, setStaySignedIn] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function handleContinue() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await fetch("/api/auth/stay-signed-in-preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ stay_signed_in: staySignedIn }),
      });
    } catch (err) {
      // Soft-fail — proceed regardless. The cookie set by
      // /api/auth/verify-otp is already in place; failure here just
      // means the user's toggle didn't reach the server. They'll
      // be re-prompted to consent next signin (since first-Pulse
      // detection is keyed off pulse_first_signin_at, not the
      // cookie shape).
      console.error("[welcome] stay-signed-in preference write failed", err);
    }
    router.push("/pulse/welcome/family");
  }

  return (
    <div className="min-h-screen bg-slate-50 px-5 py-8">
      {/* Lockup header — small, link to /pulse home. */}
      <header className="mx-auto max-w-md">
        <Link href="/pulse" aria-label="Sanocare Pulse home" className="inline-flex">
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

        {/* Checkbox + helper */}
        <label className="mt-8 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:border-primary/40">
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

        {/* CTA */}
        <button
          type="button"
          onClick={handleContinue}
          disabled={submitting}
          className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? "Saving…" : "Continue →"}
        </button>
      </main>
    </div>
  );
}
