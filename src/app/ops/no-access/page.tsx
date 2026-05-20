import Link from "next/link";
import type { Metadata } from "next";
import { ShieldOff } from "lucide-react";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Ops · No access",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function NoAccessPage() {
  const supabase = await createOpsRSCClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If they're not signed in at all, send them to login.
  if (!user) redirect("/ops/login");

  // If they ARE in ops_users (e.g. they hit this URL by accident), send them home.
  const { data: opsUser } = await supabase
    .from("ops_users")
    .select("id")
    .eq("id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (opsUser) redirect("/ops");

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center">
        <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center">
          <ShieldOff className="w-6 h-6 text-rose-600" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">No access</h1>
        <p className="text-sm text-slate-600 mb-1">
          Your account (<span className="font-mono">{user.email}</span>) is signed in, but it
          isn&apos;t a member of the Sanocare operations team.
        </p>
        <p className="text-sm text-slate-600 mb-6">
          If you think this is a mistake, ping the master admin to add you to{" "}
          <code className="font-mono text-xs">ops_users</code>.
        </p>
        <Link
          href="/ops/login"
          className="inline-block bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
        >
          Sign in with a different account
        </Link>
      </div>
    </div>
  );
}
