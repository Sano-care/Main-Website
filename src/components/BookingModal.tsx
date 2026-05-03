"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, User, Phone, MapPin, Crosshair, Loader2, ArrowRight, Check, Clock, UserCheck, Calendar, CheckCircle2, AlertCircle, Users } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import { useBookingStore } from "@/store/bookingStore";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useBookingSubmit } from "@/hooks/useBookingSubmit";
import { useCmsSection } from "@/hooks/useCmsSection";
import { BookingConfirmation } from "@/components/BookingConfirmation";
import { HOME_CONTENT } from "@/constants/cms-content";

const serviceOptions = HOME_CONTENT.bookingModal.serviceOptions;

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BookingModal({ isOpen, onClose }: BookingModalProps) {
  const { 
    name, 
    phone, 
    location, 
    serviceCategory, 
    gpsLocation,
    isLocating, 
    isSubmitting,
    locationError,
    confirmedBooking,
    isBookingForOther,
    setDetails,
    setBookingForOther,
    resetForNewBooking,
  } = useBookingStore();
  
  const modalRef = useRef<HTMLDivElement>(null);
  const { detectLocation } = useGeolocation();
  const { submitBooking } = useBookingSubmit();
  const { data: modalCopy } = useCmsSection(
    "home",
    "booking_modal",
    HOME_CONTENT.bookingModal,
  );
  const [submitStatus, setSubmitStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleGetLocation = async () => {
    try {
      await detectLocation();
    } catch (error) {
      console.error('Location error:', error);
    }
  };

  // Phone number handler - keeps +91 prefix and allows only 10 digits after
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value;
    
    // Always ensure it starts with +91
    if (!value.startsWith('+91')) {
      value = '+91 ' + value.replace(/^\+?91?\s?/, '');
    }
    
    // Extract digits after +91
    const afterPrefix = value.slice(4).replace(/\D/g, '');
    
    // Limit to 10 digits
    const limitedDigits = afterPrefix.slice(0, 10);
    
    // Format: +91 XXXXX XXXXX
    let formatted = '+91 ';
    if (limitedDigits.length > 0) {
      formatted += limitedDigits.slice(0, 5);
      if (limitedDigits.length > 5) {
        formatted += ' ' + limitedDigits.slice(5);
      }
    }
    
    setDetails({ phone: formatted });
  };

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }
    
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitStatus(null);
    
    const result = await submitBooking();
    
    if (result.success) {
      setSubmitStatus({ type: 'success', message: 'Booking submitted!' });
    } else {
      setSubmitStatus({ type: 'error', message: result.error || 'Something went wrong' });
    }
  };

  const handleBookAgain = () => {
    resetForNewBooking();
    setSubmitStatus(null);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleBackdropClick}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Modal */}
          <motion.div
            ref={modalRef}
            className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            {/* Header */}
            <div className="bg-primary px-6 py-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">
                {modalCopy.headerTitle}
              </h3>
              <button
                onClick={onClose}
                className="text-white/80 hover:text-white transition-colors p-1 rounded-full hover:bg-white/10"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Content */}
            <div className="grid md:grid-cols-2 gap-0">
              {/* Left - Info */}
              <div className="p-6 lg:p-8 bg-slate-50 border-r border-slate-100">
                <h4 className="text-lg font-bold text-text-main mb-2">
                  {modalCopy.leftPanel.title}
                </h4>
                <p className="text-sm text-text-secondary mb-6">
                  {modalCopy.leftPanel.subtitle}
                </p>

                <div className="space-y-4">
                  <h5 className="text-sm font-bold text-text-main">{modalCopy.leftPanel.nextStepsTitle}</h5>
                  
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Phone className="w-4 h-4 text-primary" />
                    </div>
                    <div className="pt-1">
                      <p className="text-sm text-text-secondary">
                        {modalCopy.leftPanel.nextSteps[0]}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <UserCheck className="w-4 h-4 text-primary" />
                    </div>
                    <div className="pt-1">
                      <p className="text-sm text-text-secondary">
                        {modalCopy.leftPanel.nextSteps[1]}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Calendar className="w-4 h-4 text-primary" />
                    </div>
                    <div className="pt-1">
                      <p className="text-sm text-text-secondary">
                        {modalCopy.leftPanel.nextSteps[2]}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div className="mt-8 pt-6 border-t border-slate-200 grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-primary">{modalCopy.leftPanel.stats[0].value}</div>
                    <div className="text-xs text-text-secondary">{modalCopy.leftPanel.stats[0].label}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-primary">{modalCopy.leftPanel.stats[1].value}</div>
                    <div className="text-xs text-text-secondary">{modalCopy.leftPanel.stats[1].label}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-primary">{modalCopy.leftPanel.stats[2].value}</div>
                    <div className="text-xs text-text-secondary">{modalCopy.leftPanel.stats[2].label}</div>
                  </div>
                </div>
              </div>

              {/* Right - Form or Confirmation */}
              <div className="p-6 lg:p-8">
                {confirmedBooking ? (
                  <BookingConfirmation 
                    booking={confirmedBooking} 
                    onBookAgain={handleBookAgain}
                    variant="modal"
                  />
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <Input
                      label={modalCopy.form.fields.patientNameLabel}
                      icon={User}
                      placeholder={modalCopy.form.fields.patientNamePlaceholder}
                      value={name}
                      onChange={(e) => setDetails({ name: e.target.value })}
                    />

                    <Input
                      label={modalCopy.form.fields.phoneLabel}
                      icon={Phone}
                      type="tel"
                      placeholder={modalCopy.form.fields.phonePlaceholder}
                      value={phone}
                      onChange={handlePhoneChange}
                    />

                    {/* Booking for someone else checkbox */}
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={isBookingForOther}
                        onChange={(e) => setBookingForOther(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                      />
                      <span className="text-xs text-text-secondary group-hover:text-text-main transition-colors flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {modalCopy.form.fields.bookingForOtherLabel}
                      </span>
                    </label>

                    {/* Location with detect button */}
                    <div className="relative">
                      <Input
                        label={modalCopy.form.fields.patientAddressLabel}
                        icon={MapPin}
                        placeholder={modalCopy.form.fields.patientAddressPlaceholder}
                        value={location}
                        onChange={(e) => setDetails({ location: e.target.value })}
                      />
                      {!isBookingForOther && (
                        <button
                          type="button"
                          onClick={handleGetLocation}
                          disabled={isLocating}
                          className="absolute right-3 top-[34px] text-xs text-primary font-medium hover:text-primary-dark transition-colors disabled:opacity-50 flex items-center gap-1"
                        >
                          {isLocating ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              {modalCopy.form.geolocation.detectingLabel}
                            </>
                          ) : (
                            <>
                              <Crosshair className="w-3 h-3" />
                              {modalCopy.form.geolocation.addGpsLabel}
                            </>
                          )}
                        </button>
                      )}
                      
                      {/* GPS Accuracy Indicator */}
                      {gpsLocation && !isBookingForOther && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-green-600">
                          <CheckCircle2 className="w-3 h-3" />
                          {modalCopy.form.geolocation.gpsAddedTemplate.replace("{accuracy}", `±${gpsLocation.accuracy}m`)}
                        </div>
                      )}
                      {locationError && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-red-500">
                          <AlertCircle className="w-3 h-3" />
                          {locationError}
                        </div>
                      )}
                      {!gpsLocation && !locationError && !isLocating && !isBookingForOther && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                          <Crosshair className="w-3 h-3" />
                          {modalCopy.form.geolocation.gpsOptionalNote}
                        </div>
                      )}
                      {isBookingForOther && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-blue-600">
                          <Users className="w-3 h-3" />
                          {modalCopy.form.geolocation.bookingForOtherNote}
                        </div>
                      )}
                    </div>

                    <Select
                      label={modalCopy.form.fields.serviceTypeLabel}
                      icon={Calendar}
                      options={serviceOptions}
                      value={serviceCategory}
                      onChange={(e) => setDetails({ serviceCategory: e.target.value })}
                    />

                    {/* Promo badge */}
                    <div className="flex justify-center">
                      <span className="inline-flex items-center gap-1 bg-orange-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                        <Check className="w-3 h-3" />
                        {modalCopy.form.promoLabel}
                      </span>
                    </div>

                    {/* Submit Status */}
                    {submitStatus && submitStatus.type === 'error' && (
                      <div className="p-3 rounded-lg text-sm flex items-center gap-2 bg-red-50 text-red-700 border border-red-200">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        {submitStatus.message}
                      </div>
                    )}

                    <Button
                      type="submit"
                      variant="primary"
                      size="lg"
                      glow
                      className="w-full"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {modalCopy.form.submittingLabel}
                        </>
                      ) : (
                        <>
                          {modalCopy.form.ctaLabel}
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </Button>

                    <p className="text-center text-xs text-gray-400 flex items-center justify-center gap-1">
                      <Clock className="w-3 h-3" />
                      {modalCopy.form.responseTimeNote}
                    </p>
                  </form>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
