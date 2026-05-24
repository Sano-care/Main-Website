import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { NewBookingForm } from "./NewBookingForm";

export const metadata: Metadata = {
  title: "Ops · New booking",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Active doctors are fetched here and passed to NewBookingForm so the
 * teleconsult flow can render a doctor selector synchronously. RLS on
 * doctors (M019) allows any ops user to SELECT; we don't need
 * service-role.
 */
async function fetchActiveDoctors() {
  const supabase = await createOpsRSCClient();
  const { data, error } = await supabase
    .from("doctors")
    .select("id, doctor_code, full_name, duty_room_join_url")
    .eq("is_active", true)
    .order("full_name", { ascending: true })
    .limit(200);
  if (error) {
    console.error("[NewBookingPage] doctors fetch failed:", error);
    return [];
  }
  return (data as Array<{
    id: string;
    doctor_code: string;
    full_name: string;
    duty_room_join_url: string | null;
  }> | null) ?? [];
}

export default async function NewBookingPage() {
  const activeDoctors = await fetchActiveDoctors();

  return (
    <div className="px-8 py-8 max-w-3xl">
      <Link
        href="/ops/bookings"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to bookings
      </Link>

      <div className="mb-6">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1">
          Operations
        </div>
        <h1 className="text-2xl font-bold text-slate-900">New booking</h1>
        <p className="text-sm text-slate-600 mt-1">
          Log a booking placed over WhatsApp or phone on behalf of a patient. A{" "}
          <span className="font-mono">SAN-B-…</span> code is allocated automatically.
        </p>
      </div>

      <NewBookingForm activeDoctors={activeDoctors} />
    </div>
  );
}
