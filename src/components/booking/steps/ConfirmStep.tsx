"use client";

// T85 PR4a — Step 4 (Confirmation).
//
// Per founder Q4 (a): close + scroll to top, sign-in agnostic. Patients
// find their case via Pulse "My bookings" once T70 ships. No navigation
// to /pulse/bookings/{id} from here.
//
// Per founder Q3 (a): display the existing `booking_code` from the
// `assign_booking_code()` trigger (M015), prefixed with "Case #" in
// the UI. The trigger produces a SAN-BOOK-NNNNN style code from
// `next_code('booking')`. If the verify response somehow returns null,
// we fall back to the raw booking ID.
//
// `aarogya_lead_alert` to ops fires server-side in /api/razorpay/verify
// — by the time we render here, the alert has already been dispatched
// (best-effort). The patient sees confirmation regardless.

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui";

interface ConfirmStepProps {
  bookingId: string;
  bookingCode: string | null;
  /** Closes the modal + scrolls to top (per founder Q4 (a)). */
  onDone: () => void;
}

const WHATSAPP_NUMBER = "919711977782"; // matches Navbar PHONE_TEL

export function ConfirmStep({
  bookingId,
  bookingCode,
  onDone,
}: ConfirmStepProps) {
  const [copied, setCopied] = useState(false);

  const displayCode = bookingCode ?? bookingId.slice(0, 8).toUpperCase();
  const waText = encodeURIComponent(`Case ${displayCode}`);
  const waHref = `https://wa.me/${WHATSAPP_NUMBER}?text=${waText}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(displayCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API can fail on http (non-https), older browsers, or
      // when permissions are blocked. Show the value clearly anyway —
      // user can long-press to copy on mobile.
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25 }}
      className="text-center"
    >
      {/* Green check badge */}
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
        <Check
          className="h-8 w-8 text-emerald-700"
          aria-hidden="true"
          strokeWidth={3}
        />
      </div>

      <h2 className="mt-4 text-2xl font-bold text-text-main">
        You&apos;re booked.
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        We&apos;ve sent the details to your WhatsApp.
      </p>

      {/* Case ID with copy button */}
      <div className="mt-5 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <span className="text-[11px] uppercase tracking-wider text-text-secondary font-semibold">
          Case
        </span>
        <code className="font-mono text-sm font-semibold text-text-main">
          #{displayCode}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy case ID"
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </button>
      </div>

      <div className="mt-6 space-y-2">
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--color-whatsapp)] hover:bg-[color:var(--color-whatsapp-dark)] px-5 py-3 text-sm font-semibold text-white transition-colors"
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          Open WhatsApp
        </a>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full"
          onClick={onDone}
        >
          Done
        </Button>
      </div>
    </motion.div>
  );
}
