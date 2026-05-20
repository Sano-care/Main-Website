import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { OpsShell } from "./_components/OpsShell";

export const metadata: Metadata = {
  title: "Ops · Home",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function OpsHomePage() {
  const supabase = await createOpsRSCClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware should have redirected already, but belt-and-braces.
  if (!user) redirect("/ops/login");

  const { data: opsUser } = await supabase
    .from("ops_users")
    .select("full_name, email, role")
    .eq("id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!opsUser) redirect("/ops/no-access");

  return (
    <OpsShell fullName={opsUser.full_name} email={opsUser.email} role={opsUser.role}>
      <div className="px-8 py-10">
        <div className="max-w-3xl">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-2">
            Operations Center
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            Welcome, {opsUser.full_name}
          </h1>
          <p className="text-slate-600">
            You&apos;re signed in as <span className="font-mono text-slate-800">{opsUser.email}</span>{" "}
            with the <span className="font-semibold">{opsUser.role}</span> role. Pick a section from
            the left nav to get started.
          </p>

          <div className="mt-10 bg-white border border-slate-200 rounded-2xl p-6">
            <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-3">
              Milestone 0 · Foundation
            </div>
            <ul className="text-sm text-slate-700 space-y-1.5 list-disc ml-5">
              <li>Supabase auth + cookie session</li>
              <li>
                <code className="font-mono text-xs">ops_users</code> table with RLS gated by{" "}
                <code className="font-mono text-xs">is_ops_user()</code>
              </li>
              <li>
                Server middleware guarding <code className="font-mono text-xs">/ops/*</code>
              </li>
              <li>Left-nav shell with placeholder sections</li>
            </ul>
          </div>
        </div>
      </div>
    </OpsShell>
  );
}
