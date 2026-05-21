import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { NewBookingForm } from "./NewBookingForm";

export const metadata: Metadata = {
  title: "Ops · New booking",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function NewBookingPage() {
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

      <NewBookingForm />
    </div>
  );
}
