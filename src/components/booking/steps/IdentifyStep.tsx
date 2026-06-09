"use client";

// T85 PR4a — Step 1 (Identify).
//
// Surfaces a single "Quick details" form to collect the patient's name.
// Phone is collected + OTP-verified upstream by T61's BookingGate
// (mounted in Navbar) before the modal ever opens. By the time the
// patient lands here, `bookingStore.phoneVerifiedUntil` is in the
// future and `bookingStore.phone` is populated. We only need a name.
//
// Auto-advance:
//   - If `bookingStore.name` is already set (returning patient), the
//     orchestrator skips this step entirely. No render needed.
//
// T64 prop API:
//   - `onComplete({ name, phone })` is the hand-off seam the
//     family-member-picker (T64) will widen to `{ name, phone, member }`
//     without changing this file's contract. PR4a passes the simple
//     payload; T64 wraps this component with the picker and adds the
//     member field before calling the parent's onComplete.

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, User } from "lucide-react";
import { Button } from "@/components/ui";
import { useBookingStore } from "@/store/bookingStore";

export interface IdentifyPayload {
  name: string;
  phone: string;
}

interface IdentifyStepProps {
  onComplete: (patient: IdentifyPayload) => void;
}

export function IdentifyStep({ onComplete }: IdentifyStepProps) {
  const storeName = useBookingStore((s) => s.name);
  const phone = useBookingStore((s) => s.phone);
  const verifiedFullName = useBookingStore((s) => s.verifiedFullName);
  const setDetails = useBookingStore((s) => s.setDetails);

  // T64: pre-fill from customers.full_name (returned by /api/auth/verify-otp
  // when the phone is a known customer). storeName wins when present — a
  // returning patient who back-out + re-enters keeps their last typed value.
  const initialName = storeName || verifiedFullName || "";
  const wasPrefilledFromCustomer = !storeName && Boolean(verifiedFullName);

  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const trimmedLower = trimmed.toLowerCase();
  // T64 + customer-link-hotpatch: server-side validatePatientName mirrors
  // these rules. Keep them in sync — if you add a placeholder here, add
  // it to src/lib/booking/customerLink.ts too.
  const canSubmit =
    trimmed.length >= 2 &&
    !submitting &&
    trimmedLower !== "patient" &&
    trimmedLower !== "user" &&
    trimmedLower !== "test" &&
    trimmedLower !== "name";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    // Persist into the store immediately so a back-out + re-entry
    // doesn't lose the input. We don't gate on a network call here —
    // OTP verification already happened upstream.
    setDetails({ name: trimmed });
    onComplete({ name: trimmed, phone });
    setSubmitting(false);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center gap-2 text-primary">
        <User className="h-5 w-5" />
        <span className="text-xs font-mono uppercase tracking-widest">
          Quick details
        </span>
      </div>
      <h2 className="mt-2 text-2xl font-bold text-text-main">
        Who&apos;s the visit for?
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        We use your name on the e-prescription and to greet the patient at the
        door.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary">
            Patient name
          </label>
          <input
            type="text"
            autoComplete="name"
            autoFocus={!wasPrefilledFromCustomer}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              wasPrefilledFromCustomer
                ? `Booking for ${verifiedFullName}? Edit if different.`
                : "e.g. Rajesh Kumar"
            }
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all placeholder:text-slate-400"
          />
          <p className="mt-1.5 text-[11px] text-text-secondary">
            {wasPrefilledFromCustomer
              ? "Pre-filled from your last booking. Change if booking for someone else."
              : "Minimum 2 characters. We'll confirm with this name on arrival."}
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          disabled={!canSubmit}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Continuing&hellip;
            </>
          ) : (
            <>
              Continue
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </form>
    </motion.div>
  );
}
