"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  CircleCheck,
} from "lucide-react";
import { BookingRow, SERVICE_LABELS } from "@/lib/supabase";

interface CompleteVisitModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: BookingRow | null;
  onConfirm: (bookingId: string) => Promise<{ success: boolean; error?: string }>;
  isDark?: boolean;
}

const COMPLETION_RULES = [
  "Payment has been collected from the patient or payment confirmation received",
  "The paramedic/doctor has confirmed service completion",
  "All required medical documentation has been completed",
  "Patient has acknowledged the service delivery",
  "Any patient feedback or complaints have been noted",
];

export function CompleteVisitModal({
  isOpen,
  onClose,
  booking,
  onConfirm,
  isDark = true,
}: CompleteVisitModalProps) {
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!booking) return null;

  const handleConfirm = async () => {
    if (!isConfirmed) {
      setError("Please confirm that you have verified all requirements.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const result = await onConfirm(booking.id);

    if (result.success) {
      // Reset state and close
      setIsConfirmed(false);
      onClose();
    } else {
      setError(result.error || "Failed to complete visit. Please try again.");
    }

    setIsSubmitting(false);
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setIsConfirmed(false);
      setError(null);
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md ${
              isDark ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200"
            } border rounded-2xl shadow-2xl z-50 overflow-hidden`}
          >
            {/* Header */}
            <div
              className={`flex items-center justify-between px-6 py-4 border-b ${
                isDark ? "border-slate-700" : "border-slate-200"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full bg-green-500/20 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <h2
                    className={`text-lg font-semibold ${
                      isDark ? "text-white" : "text-slate-900"
                    }`}
                  >
                    Complete Visit
                  </h2>
                  <p
                    className={`text-sm ${
                      isDark ? "text-slate-400" : "text-slate-500"
                    }`}
                  >
                    Confirm checklist before closing
                  </p>
                </div>
              </div>
              <button
                onClick={handleClose}
                disabled={isSubmitting}
                className={`p-2 rounded-lg transition-colors ${
                  isDark
                    ? "hover:bg-slate-700 text-slate-400 hover:text-white"
                    : "hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                } disabled:opacity-50`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-5">
              {/* Booking Summary */}
              <div
                className={`${
                  isDark
                    ? "bg-slate-900/50 border-slate-700"
                    : "bg-slate-50 border-slate-200"
                } border rounded-xl p-4`}
              >
                <p
                  className={`text-sm font-medium ${
                    isDark ? "text-white" : "text-slate-900"
                  }`}
                >
                  {booking.patient_name}
                </p>
                <p
                  className={`text-xs ${
                    isDark ? "text-slate-400" : "text-slate-500"
                  }`}
                >
                  {SERVICE_LABELS[booking.service_category] ||
                    booking.service_category}
                  {booking.amount != null &&
                    booking.amount > 0 &&
                    // eslint-disable-next-line no-restricted-syntax -- Number.toLocaleString for currency, not Date.
                    ` · ₹${booking.amount.toLocaleString()}`}
                </p>
              </div>

              {/* Rules as bullet points */}
              <div className="space-y-3">
                <p
                  className={`text-sm font-medium ${
                    isDark ? "text-slate-300" : "text-slate-700"
                  }`}
                >
                  Before completing, ensure the following:
                </p>
                <ul className="space-y-2">
                  {COMPLETION_RULES.map((rule, index) => (
                    <li
                      key={index}
                      className={`flex items-start gap-2 text-sm ${
                        isDark ? "text-slate-400" : "text-slate-600"
                      }`}
                    >
                      <CircleCheck className={`w-4 h-4 mt-0.5 shrink-0 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
                      <span>{rule}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Single Confirmation Checkbox */}
              <label
                className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
                  isConfirmed
                    ? isDark
                      ? "bg-green-500/10 border-green-500/30"
                      : "bg-green-50 border-green-300"
                    : isDark
                    ? "bg-slate-800/50 border-slate-700 hover:border-slate-600"
                    : "bg-white border-slate-200 hover:border-slate-300"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isConfirmed}
                  onChange={(e) => setIsConfirmed(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={`mt-0.5 size-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                    isConfirmed
                      ? "bg-green-500 border-green-500"
                      : isDark
                      ? "border-slate-600"
                      : "border-slate-300"
                  }`}
                >
                  {isConfirmed && (
                    <svg
                      className="w-3 h-3 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </div>
                <div className="flex-1">
                  <p
                    className={`text-sm font-medium ${
                      isDark ? "text-white" : "text-slate-900"
                    }`}
                  >
                    I confirm all requirements are met
                  </p>
                  <p
                    className={`text-xs mt-0.5 ${
                      isDark ? "text-slate-400" : "text-slate-500"
                    }`}
                  >
                    Payment collected, service completed, and documentation done
                  </p>
                </div>
              </label>

              {/* Warning */}
              <div
                className={`flex items-start gap-3 p-3 rounded-lg ${
                  isDark
                    ? "bg-amber-500/10 border border-amber-500/20"
                    : "bg-amber-50 border border-amber-200"
                }`}
              >
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <p
                  className={`text-sm ${
                    isDark ? "text-amber-300" : "text-amber-700"
                  }`}
                >
                  This action cannot be undone. The visit will be marked as completed.
                </p>
              </div>

              {/* Error */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  {error}
                </motion.div>
              )}
            </div>

            {/* Footer */}
            <div
              className={`flex items-center justify-end gap-3 px-6 py-4 border-t ${
                isDark
                  ? "border-slate-700 bg-slate-800/50"
                  : "border-slate-200 bg-slate-50"
              }`}
            >
              <button
                onClick={handleClose}
                disabled={isSubmitting}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  isDark
                    ? "text-slate-400 hover:text-white"
                    : "text-slate-500 hover:text-slate-900"
                } disabled:opacity-50`}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={isSubmitting || !isConfirmed}
                className="flex items-center gap-2 px-5 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                Complete Visit
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
