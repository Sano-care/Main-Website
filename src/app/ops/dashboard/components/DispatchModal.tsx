"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  User,
  Phone,
  MapPin,
  Stethoscope,
  Clock,
  Send,
  Loader2,
  ExternalLink,
  MessageCircle,
} from "lucide-react";
import { BookingRow, Paramedic, SERVICE_LABELS } from "@/lib/supabase";
import { formatIST } from "@/lib/time/formatIST";

interface DispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: BookingRow | null;
  paramedics: Paramedic[];
  onDispatch: (bookingId: string, paramedicId: string) => Promise<{ success: boolean; error?: string }>;
  isDark?: boolean;
}

export function DispatchModal({
  isOpen,
  onClose,
  booking,
  paramedics,
  onDispatch,
  isDark = true,
}: DispatchModalProps) {
  const [selectedParamedic, setSelectedParamedic] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!booking) return null;

  const handleDispatch = async () => {
    if (!selectedParamedic) {
      setError("Please select a paramedic");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const paramedic = paramedics.find((p) => p.id === selectedParamedic);
    if (!paramedic) {
      setError("Invalid paramedic selected");
      setIsSubmitting(false);
      return;
    }

    // First update the booking
    const result = await onDispatch(booking.id, selectedParamedic);

    if (result.success) {
      // Open WhatsApp with pre-filled message
      const gps = booking.gps_location as { lat: number; lng: number } | null;
      const mapsLink = gps?.lat && gps?.lng
        ? `https://www.google.com/maps?q=${gps.lat},${gps.lng}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(booking.manual_address)}`;

      const message = `🚨 *New Assignment from Sanocare*

👤 *Patient:* ${booking.patient_name}
📞 *Phone:* ${booking.phone}

🩺 *Service:* ${SERVICE_LABELS[booking.service_category] || booking.service_category}
${
      booking.amount != null && booking.amount > 0
        // eslint-disable-next-line no-restricted-syntax -- Number.toLocaleString for currency, not Date.
        ? `💰 *Price:* ₹${booking.amount.toLocaleString()}`
        : ""
    }

📍 *Address:* ${booking.manual_address}
🗺️ *Maps:* ${mapsLink}

${booking.specific_ailment ? `📝 *Notes:* ${booking.specific_ailment}` : ""}

Please proceed immediately. Reply when you reach the location.`;

      // Format phone for WhatsApp (remove spaces, add country code if needed)
      const whatsappPhone = paramedic.phone.replace(/\s+/g, "").replace(/^\+/, "");
      const whatsappUrl = `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(message)}`;

      // Open WhatsApp
      window.open(whatsappUrl, "_blank");

      // Reset and close
      setSelectedParamedic("");
      onClose();
    } else {
      setError(result.error || "Failed to dispatch");
    }

    setIsSubmitting(false);
  };

  const getGoogleMapsUrl = () => {
    const gps = booking.gps_location as { lat: number; lng: number } | null;
    if (gps?.lat && gps?.lng) {
      return `https://www.google.com/maps?q=${gps.lat},${gps.lng}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      booking.manual_address
    )}`;
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
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200"} border rounded-2xl shadow-2xl z-50 overflow-hidden`}
          >
            {/* Header */}
            <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? "border-slate-700" : "border-slate-200"}`}>
              <div>
                <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>Dispatch Paramedic</h2>
                <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>Assign and notify via WhatsApp</p>
              </div>
              <button
                onClick={onClose}
                className={`p-2 rounded-lg ${isDark ? "hover:bg-slate-700 text-slate-400 hover:text-white" : "hover:bg-slate-100 text-slate-400 hover:text-slate-600"} transition-colors`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Patient Summary */}
              <div className={`${isDark ? "bg-slate-900/50 border-slate-700" : "bg-slate-50 border-slate-200"} border rounded-xl p-4 space-y-3`}>
                <h3 className={`text-sm font-medium ${isDark ? "text-slate-400" : "text-slate-500"} uppercase tracking-wider`}>
                  Patient Details
                </h3>

                <div className="grid gap-3">
                  <div className="flex items-center gap-3">
                    <User className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
                    <span className={`${isDark ? "text-white" : "text-slate-900"} font-medium`}>{booking.patient_name}</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <Phone className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
                    <a
                      href={`tel:${booking.phone}`}
                      className={`${isDark ? "text-slate-300" : "text-slate-600"} hover:text-primary transition-colors`}
                    >
                      {booking.phone}
                    </a>
                  </div>

                  <div className="flex items-start gap-3">
                    <MapPin className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-slate-400"} mt-0.5`} />
                    <div>
                      <p className={`${isDark ? "text-slate-300" : "text-slate-600"}`}>{booking.manual_address}</p>
                      <a
                        href={getGoogleMapsUrl()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-1"
                      >
                        Open in Maps
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Stethoscope className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
                    <span className={`${isDark ? "text-slate-300" : "text-slate-600"}`}>
                      {SERVICE_LABELS[booking.service_category] || booking.service_category}
                    </span>
                    {booking.amount != null && booking.amount > 0 && (
                      <span className="text-primary font-semibold">
                        {/* eslint-disable-next-line no-restricted-syntax -- Number.toLocaleString for currency, not Date. */}
                        ₹{booking.amount.toLocaleString()}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <Clock className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
                    <span className={`${isDark ? "text-slate-400" : "text-slate-500"} text-sm`}>
                      Booked: {formatIST(booking.created_at)}
                    </span>
                  </div>

                  {booking.specific_ailment && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mt-2">
                      <p className="text-sm text-amber-300">
                        <strong>Notes:</strong> {booking.specific_ailment}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Paramedic Selection */}
              <div>
                <label className={`block text-sm font-medium ${isDark ? "text-slate-300" : "text-slate-700"} mb-2`}>
                  Select Paramedic
                </label>
                <select
                  value={selectedParamedic}
                  onChange={(e) => {
                    setSelectedParamedic(e.target.value);
                    setError(null);
                  }}
                  className={`w-full px-4 py-3 ${isDark ? "bg-slate-900/50 border-slate-700 text-white" : "bg-slate-50 border-slate-200 text-slate-900"} border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary`}
                >
                  <option value="">Choose a paramedic...</option>
                  {paramedics.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} - {p.specialty || "General Care"} ({p.phone})
                    </option>
                  ))}
                </select>
                {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
                {paramedics.length === 0 && (
                  <p className="text-amber-400 text-sm mt-2">
                    No paramedics available. Add paramedics in Field Force tab.
                  </p>
                )}
              </div>

              {/* WhatsApp Info */}
              <div className="flex items-start gap-3 bg-green-500/10 border border-green-500/20 rounded-xl p-4">
                <MessageCircle className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                <div className="text-sm text-green-300">
                  <p className="font-medium">WhatsApp Notification</p>
                  <p className="text-green-400/80 mt-1">
                    Clicking dispatch will open WhatsApp with a pre-filled message containing
                    patient details and location link.
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className={`flex items-center justify-end gap-3 px-6 py-4 border-t ${isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200 bg-slate-50"}`}>
              <button
                onClick={onClose}
                className={`px-4 py-2 ${isDark ? "text-slate-400 hover:text-white" : "text-slate-500 hover:text-slate-900"} text-sm font-medium transition-colors`}
              >
                Cancel
              </button>
              <button
                onClick={handleDispatch}
                disabled={isSubmitting || !selectedParamedic}
                className="flex items-center gap-2 px-5 py-2 bg-primary hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Dispatch & Notify
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
