"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Users } from "lucide-react";

import { AddMemberForm } from "../../../(authed)/family-members/_components/AddMemberForm";

/**
 * T90 Pulse v1 Phase 1 — Welcome Step 2 (Surface 1 — family prompt).
 *
 * Copy 100% locked (brief copy spec):
 *   Headline: Caring for someone in your family?
 *   Body:     Add the people you care for — your parents, your kids,
 *             anyone. You'll book their visits, see their reports, and
 *             track their care from here.
 *   Primary:  + Add a family member  (opens AddMemberForm; on save → /pulse)
 *   Secondary: I'll do this later    (routes directly to /pulse)
 *
 * Reuses the existing T64 AddMemberForm from (authed)/family-members/.
 * The form's onSaved callback closes the modal and routes to /pulse —
 * the user has just completed onboarding so the home zone is the
 * natural landing.
 *
 * Onboarding-flow exit point: both CTAs route to /pulse, marking the
 * end of the welcome sequence. The (authed) chrome wraps /pulse so the
 * user's first sight of the app bar + drawer is on the home page.
 */

export default function PulseWelcomeStep2Page() {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);

  function handleSkip() {
    router.push("/pulse");
  }

  function handleAdded() {
    // Form's onSaved fires after a successful POST /api/pulse/family-members.
    // Close the form + route to home; the AddMemberForm's own internal
    // state will reset on next mount.
    setAddOpen(false);
    router.push("/pulse");
  }

  return (
    <div className="min-h-screen bg-slate-50 px-5 py-8">
      {/* Lockup header */}
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
        {/* Hero icon */}
        <div className="flex justify-center">
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary-50 text-primary">
            <Users className="h-8 w-8" aria-hidden="true" />
          </span>
        </div>

        <h1 className="mt-6 text-center text-2xl font-bold tracking-tight text-text-main">
          Caring for someone in your family?
        </h1>

        <p className="mt-4 text-center text-sm leading-relaxed text-text-secondary">
          Add the people you care for — your parents, your kids, anyone.
          You&apos;ll book their visits, see their reports, and track their
          care from here.
        </p>

        {/* Primary CTA — opens AddMemberForm */}
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-opacity hover:opacity-90"
        >
          + Add a family member
        </button>

        {/* Secondary CTA — skip to home */}
        <button
          type="button"
          onClick={handleSkip}
          className="mt-3 inline-flex w-full items-center justify-center rounded-2xl px-6 py-3.5 text-sm font-medium text-text-secondary hover:bg-slate-50"
        >
          I&apos;ll do this later
        </button>
      </main>

      {/* T64 AddMemberForm — verbatim reuse. Modal sits on top of the */}
      {/* welcome card; on save it closes + routes to /pulse. */}
      <AddMemberForm
        open={addOpen}
        editing={null}
        onClose={() => setAddOpen(false)}
        onSaved={handleAdded}
      />
    </div>
  );
}
