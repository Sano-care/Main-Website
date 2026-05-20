import type { Metadata } from "next";
import { getCurrentOpsUser } from "../_lib/getCurrentOpsUser";

export const metadata: Metadata = {
  title: "Ops · Home",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function OpsHomePage() {
  const opsUser = await getCurrentOpsUser();

  return (
    <div className="px-8 py-10">
      <div className="max-w-3xl">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-2">
          Operations Center
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          Welcome, {opsUser.full_name}
        </h1>
        <p className="text-slate-600">
          You&apos;re signed in as{" "}
          <span className="font-mono text-slate-800">{opsUser.email}</span> with
          the <span className="font-semibold">{opsUser.role}</span> role. Pick a
          section from the left nav to get started.
        </p>

        <div className="mt-10 grid sm:grid-cols-2 gap-4">
          <a
            href="/ops/patients"
            className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-slate-400 transition-colors block"
          >
            <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-2">
              Master records
            </div>
            <div className="text-lg font-semibold text-slate-900">Patients</div>
            <div className="text-sm text-slate-600 mt-1">
              Search, create, and view customer records with SAN-C-… codes.
            </div>
          </a>
          <a
            href="/ops/partners"
            className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-slate-400 transition-colors block"
          >
            <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-2">
              Master records
            </div>
            <div className="text-lg font-semibold text-slate-900">Partners</div>
            <div className="text-sm text-slate-600 mt-1">
              Societies, clinics, corporates, individuals — with SAN-P-… codes.
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}
