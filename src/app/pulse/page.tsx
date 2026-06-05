import Link from "next/link";
import { Activity, Pill } from "lucide-react";

import { PulseShell } from "./_components/PulseShell";
import { getCurrentCustomer } from "./_lib/getCurrentCustomer";

// Pulse home — B1 PLACEHOLDER.
//
// B1 ships this thin authenticated landing so the /portal→/pulse redirect has
// a real destination and PulseShell (auth + redirect-to-login) is exercised
// end-to-end in the preview. B2 REPLACES this with the two hero tiles per
// Sanocare_Pulse_Web_Mockup_v1.html (vitals + medications, SectionReveal +
// AnimatedCounter). Keep the surface area tiny so that swap is clean.

export const dynamic = "force-dynamic";

export default async function PulseHomePage() {
  return (
    <PulseShell next="/pulse">
      <PulseHomeBody />
    </PulseShell>
  );
}

async function PulseHomeBody() {
  // Safe inside PulseShell — the shell already redirected unauthenticated
  // visitors, so a customer is guaranteed here.
  const customer = await getCurrentCustomer();
  const firstName = customer?.full_name?.trim().split(/\s+/)[0] ?? "there";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-xs font-mono uppercase tracking-widest text-primary">
          Sanocare Pulse
        </p>
        <h1 className="mt-2 text-3xl font-bold text-text-main">
          Hi {firstName}.
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Your vitals and medicines, in one place. (Full dashboard arrives
          next.)
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Link
            href="/pulse/vitals"
            className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
          >
            <Activity className="h-6 w-6 text-primary" />
            <h2 className="mt-3 text-lg font-bold text-text-main">Vitals</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Track BP, sugar, and weight over time.
            </p>
          </Link>
          <Link
            href="/pulse/medications"
            className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
          >
            <Pill className="h-6 w-6 text-primary" />
            <h2 className="mt-3 text-lg font-bold text-text-main">
              Medications
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              Schedules, doses, and a tap to mark each one taken.
            </p>
          </Link>
        </div>
      </main>
    </div>
  );
}
