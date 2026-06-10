"use client";

// T85 PR4a — Step 2 (Where + When).
//
// Two stacked sub-steps in a single panel:
//   1. Where — address picker (reuses C3-Loc via useGeolocation +
//      manual textarea). Mirror of T61 BookingModal's address UX, but
//      with copy adapted per service:
//        - Home-Visit / Medic at Home → "Where should we come?"
//        - Teleconsultation           → "Confirm your details"
//          (address still needed for emergency-escalation per MoHFW 2020)
//   2. When — universal SchedulePicker. ASAP default; "Schedule for
//      later" expands a date-strip + hour-slot grid inline.
//
// Step 2 commits its state by calling `onContinue()`. The orchestrator
// advances to PaymentStep after the bookingStore reflects address +
// schedule. The Continue button stays disabled until the address is at
// least 10 characters (mirrors useBookingSubmit's existing validation).

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Loader2,
  MapPin,
  AlertCircle,
  Crosshair,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui";
import { useBookingStore } from "@/store/bookingStore";
import { useGeolocation } from "@/hooks/useGeolocation";
import { SchedulePicker } from "@/components/booking/SchedulePicker";
import type { ServiceSlug } from "@/lib/services/catalog";

interface WhereWhenStepProps {
  serviceSlug: ServiceSlug;
  onContinue: () => void;
}

function asapCopyFor(slug: ServiceSlug): string {
  switch (slug) {
    case "teleconsultation":
      return "Live video starts in ~15 min";
    case "home-visit":
    case "medic-at-home":
      return "We'll arrive in ~30 min";
    case "lab-tests":
      return "Phlebotomist arrives in ~90 min";
  }
}

function headlineFor(slug: ServiceSlug): string {
  return slug === "teleconsultation"
    ? "Confirm your details"
    : "Where should we come?";
}

function whyAddressFor(slug: ServiceSlug): string {
  return slug === "teleconsultation"
    ? "MoHFW 2020 requires an address on file for emergency escalation."
    : "We'll route the medic to this address. GPS gives us the best ETA.";
}

export function WhereWhenStep({ serviceSlug, onContinue }: WhereWhenStepProps) {
  const location = useBookingStore((s) => s.location);
  const setDetails = useBookingStore((s) => s.setDetails);
  const scheduledFor = useBookingStore((s) => s.scheduledFor);
  const setScheduledFor = useBookingStore((s) => s.setScheduledFor);
  const isLocating = useBookingStore((s) => s.isLocating);
  const locationError = useBookingStore((s) => s.locationError);
  const gpsLocation = useBookingStore((s) => s.gpsLocation);

  const { detectLocation } = useGeolocation();
  const [detectError, setDetectError] = useState<string | null>(null);

  const trimmed = location.trim();
  const canContinue = trimmed.length >= 10;

  async function handleDetect() {
    setDetectError(null);
    try {
      await detectLocation();
    } catch (err) {
      // useGeolocation already pushes the message into bookingStore via
      // setLocationError; we mirror to a local var so a transient
      // setDetectError flash matches the inline error UI consistently.
      setDetectError(
        err instanceof Error
          ? err.message
          : "Couldn't read your location. Type the address instead.",
      );
    }
  }

  const errorToShow = detectError ?? locationError;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center gap-2 text-primary">
        {serviceSlug === "teleconsultation" ? (
          <Video className="h-5 w-5" />
        ) : (
          <MapPin className="h-5 w-5" />
        )}
        <span className="text-xs font-mono uppercase tracking-widest">
          Where &amp; when
        </span>
      </div>
      <h2 className="mt-2 text-2xl font-bold text-text-main">
        {headlineFor(serviceSlug)}
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        {whyAddressFor(serviceSlug)}
      </p>

      {/* Address block */}
      <div className="mt-5 space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary">
            Address
          </label>
          <button
            type="button"
            onClick={handleDetect}
            disabled={isLocating}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary hover:underline disabled:opacity-60"
          >
            {isLocating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Detecting&hellip;
              </>
            ) : (
              <>
                <Crosshair className="h-3.5 w-3.5" />
                Use my location
              </>
            )}
          </button>
        </div>
        <textarea
          rows={3}
          autoComplete="street-address"
          placeholder="Flat / House no., street, locality, city"
          value={location}
          onChange={(e) => setDetails({ location: e.target.value })}
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all placeholder:text-slate-400 resize-none"
        />
        {gpsLocation && (
          <p className="text-[11px] text-emerald-700">
            📍 GPS locked at {gpsLocation.accuracy}m accuracy.
          </p>
        )}
        {errorToShow && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[12px] text-amber-800">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{errorToShow}</span>
          </div>
        )}
      </div>

      {/* Schedule picker */}
      <div className="mt-5">
        <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary mb-1.5">
          When
        </label>
        <SchedulePicker
          value={scheduledFor}
          onChange={setScheduledFor}
          asapLabel={asapCopyFor(serviceSlug)}
        />
      </div>

      <Button
        type="button"
        variant="primary"
        size="lg"
        className="mt-6 w-full"
        disabled={!canContinue}
        onClick={onContinue}
      >
        Continue to payment
        <ArrowRight className="h-4 w-4" />
      </Button>
      {!canContinue && trimmed.length > 0 && (
        <p className="mt-2 text-[11px] text-text-secondary">
          Add a bit more detail (flat / floor / landmark) so we don&apos;t miss
          the door.
        </p>
      )}
    </motion.div>
  );
}
