import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { createOpsRSCClient } from "@/lib/supabase-rsc";

export const metadata: Metadata = {
  title: "Ops · Partner detail",
  robots: { index: false, follow: false },
};

// See bookings/[id]/page.tsx for the full rationale. Same belt-and-
// suspenders: page is fully dynamic + no ISR + no fetch cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type Partner = {
  id: string;
  partner_code: string;
  name: string;
  partner_type: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address_line: string | null;
  city: string | null;
  pincode: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

const TYPE_STYLE: Record<string, string> = {
  society: "bg-emerald-100 text-emerald-800",
  clinic: "bg-blue-100 text-blue-800",
  corporate: "bg-violet-100 text-violet-800",
  individual: "bg-amber-100 text-amber-800",
};

export default async function PartnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createOpsRSCClient();

  const { data } = await supabase
    .from("partners")
    .select(
      "id, partner_code, name, partner_type, contact_name, phone, email, address_line, city, pincode, notes, is_active, created_at",
    )
    .eq("id", id)
    .maybeSingle();

  const partner = data as Partner | null;
  if (!partner) notFound();

  return (
    <div className="px-8 py-8 max-w-5xl">
      <Link
        href="/ops/partners"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to partners
      </Link>

      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="font-mono text-xs text-slate-500 mb-1">
            {partner.partner_code}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900">{partner.name}</h1>
            <span
              className={
                "inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full " +
                (TYPE_STYLE[partner.partner_type] ?? "bg-slate-100 text-slate-700")
              }
            >
              {partner.partner_type}
            </span>
            {!partner.is_active && (
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                inactive
              </span>
            )}
          </div>
          <div className="text-sm text-slate-600 mt-1">
            Created {new Date(partner.created_at).toLocaleString("en-IN")}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-3">
          Profile
        </div>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <DetailRow label="Contact name" value={partner.contact_name} />
          <DetailRow label="Phone" value={partner.phone} mono />
          <DetailRow label="Email" value={partner.email} />
          <DetailRow label="City" value={partner.city} />
          <DetailRow label="Address" value={partner.address_line} />
          <DetailRow label="Pincode" value={partner.pincode} mono />
        </div>
        {partner.notes && (
          <div className="mt-5 pt-5 border-t border-slate-100">
            <div className="text-xs text-slate-500 mb-1">Notes</div>
            <div className="text-sm text-slate-800 whitespace-pre-wrap">{partner.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={"text-slate-900 " + (mono ? "font-mono text-sm" : "")}>
        {value ?? "—"}
      </div>
    </div>
  );
}
