import type { Metadata } from "next";
import { getCurrentOpsUser } from "../../_lib/getCurrentOpsUser";
import { CreateMedicForm } from "./CreateMedicForm";

export const metadata: Metadata = {
  title: "Ops · Add Medic",
  robots: { index: false, follow: false },
};

// T65 Phase 2 C3-quick — interim Add-Medic page.
//
// Founder directive 2026-06-17: Hub Add-Medic UI is the entry point for
// fresh medic data post-deploy. C3-full ships the full Hub (list + edit
// + 5-tab detail page); this page is the smallest unblocker so founder
// can seed UAT today.
//
// Admin-only — getCurrentOpsUser() redirects non-auth, and the form
// submit action throws on non-admin role. No nav link from /ops →
// here per founder spec; ops bookmark the URL directly.
//
// No list page, no edit page, no tabs, no docs upload, no ledger.

export default async function NewMedicPage() {
  const opsUser = await getCurrentOpsUser();

  if (opsUser.role !== "admin") {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-semibold text-slate-900">Add Medic</h1>
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-6">
          <div className="text-sm font-medium text-red-900">
            Admin role required.
          </div>
          <div className="text-sm text-red-700 mt-1">
            Your ops account ({opsUser.email}) is signed in as{" "}
            <span className="font-mono">{opsUser.role}</span>. Medic
            creation is restricted to admins.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="mb-8">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1">
          T65 Phase 2 · Interim
        </div>
        <h1 className="text-2xl font-semibold text-slate-900">Add Medic</h1>
        <p className="text-sm text-slate-500 mt-1">
          Seeds a new row in the <span className="font-mono">medics</span>{" "}
          table. Phone becomes the OTP-login credential for the Sanocare
          Medic Android app. Full Hub (list + edit + tabs) ships in C3-full.
        </p>
      </div>
      <CreateMedicForm />
    </div>
  );
}
