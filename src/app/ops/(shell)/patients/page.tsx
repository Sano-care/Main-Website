import Link from "next/link";
import type { Metadata } from "next";
import { Search, Plus } from "lucide-react";
import { createOpsRSCClient } from "@/lib/supabase-rsc";

export const metadata: Metadata = {
  title: "Ops · Patients",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type CustomerRow = {
  id: string;
  customer_code: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  created_at: string;
};

// Strip characters that confuse the PostgREST `.or()` filter parser.
function sanitizeSearch(q: string): string {
  return q.replace(/[%,()]/g, "").trim().slice(0, 100);
}

export default async function PatientsListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q: rawQ = "" } = await searchParams;
  const q = sanitizeSearch(rawQ);

  const supabase = await createOpsRSCClient();
  let query = supabase
    .from("customers")
    .select("id, customer_code, full_name, phone, email, city, created_at");

  if (q) {
    query = query.or(
      `full_name.ilike.%${q}%,phone.ilike.%${q}%,customer_code.ilike.%${q}%`,
    );
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(200);

  const customers = (data as CustomerRow[] | null) ?? [];

  return (
    <div className="px-8 py-8">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1">
            Master records
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Patients</h1>
          <p className="text-sm text-slate-600 mt-1">
            {customers.length} record{customers.length === 1 ? "" : "s"}
            {q && (
              <>
                {" "}matching <span className="font-mono">&ldquo;{q}&rdquo;</span>
              </>
            )}
          </p>
        </div>
        <Link
          href="/ops/patients/new"
          className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New patient
        </Link>
      </div>

      <form className="mb-6" method="GET">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by name, phone, or SAN-C code…"
            className="w-full bg-white border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
          />
        </div>
      </form>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-3 mb-4">
          Could not load customers: {error.message}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {customers.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-500">
            {q
              ? "No patients match that search."
              : "No patients yet. Run migration 013 to backfill from bookings, or click “New patient”."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left">
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Code
                </th>
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Name
                </th>
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Phone
                </th>
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Email
                </th>
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  City
                </th>
                <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customers.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Link
                      href={`/ops/patients/${c.id}`}
                      className="font-mono text-xs text-slate-900 hover:text-primary underline"
                    >
                      {c.customer_code}
                    </Link>
                  </td>
                  <td className="px-5 py-3 font-medium text-slate-900">
                    {c.full_name}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{c.phone ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{c.email ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{c.city ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-500 text-xs">
                    {new Date(c.created_at).toLocaleDateString("en-IN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
