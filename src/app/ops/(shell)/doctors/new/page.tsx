import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { getCurrentOpsUser } from "../../../_lib/getCurrentOpsUser";
import { NewDoctorForm } from "./NewDoctorForm";

export const metadata: Metadata = {
  title: "Ops · New doctor",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function NewDoctorPage() {
  // Admin-only gate at the page level. The server action re-checks
  // via is_ops_admin() too — never trust the UI gate alone.
  const opsUser = await getCurrentOpsUser();
  if (opsUser.role !== "admin") redirect("/ops/doctors");

  return (
    <div className="px-8 py-8 max-w-3xl">
      <Link
        href="/ops/doctors"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to doctors
      </Link>

      <div className="mb-6">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1">
          Operations
        </div>
        <h1 className="text-2xl font-bold text-slate-900">New doctor</h1>
        <p className="text-sm text-slate-600 mt-1">
          A <span className="font-mono">SAN-D-…</span> code is allocated automatically.
          Pick a type — the pay fields below adapt to it.
        </p>
      </div>

      <NewDoctorForm />
    </div>
  );
}
