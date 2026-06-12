"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";

import { useBookingFlow } from "@/hooks/useBookingFlow";
import { WHATSAPP_DEEPLINK } from "@/lib/contact";
import type { ServiceSlug } from "@/lib/services/catalog";

// Interactive booking CTA for the SEO service pages. The page itself stays a
// server component (for metadata + indexable schema); this small client island
// drives the booking flow. The BookingModal / BookingGate are mounted by
// <Navbar /> on the same page, and useBookingFlow is Zustand-backed (no
// provider needed), so requestBooking* opens the gate/modal from here.

export function BookVisitCta({
  serviceSlug,
  className = "",
}: {
  serviceSlug: ServiceSlug;
  className?: string;
}) {
  const { requestBookingForService, requestBookingForLab } = useBookingFlow();

  const onBook = () =>
    serviceSlug === "lab-tests"
      ? requestBookingForLab()
      : requestBookingForService(serviceSlug);

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <button
        type="button"
        onClick={onBook}
        className="inline-flex items-center justify-center rounded-full bg-primary px-7 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
      >
        Book a visit
      </button>
      <Link
        href={WHATSAPP_DEEPLINK}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-6 py-3 text-base font-semibold text-text-main transition-colors hover:border-primary hover:text-primary"
      >
        <MessageCircle className="h-5 w-5" aria-hidden="true" />
        WhatsApp us
      </Link>
    </div>
  );
}
