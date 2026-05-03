"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { User, Phone, MapPin, Loader2, ArrowRight, Shield, Lock, Crosshair, CheckCircle2, AlertCircle, Users } from "lucide-react";
import { GlassCard, Button, Input, Select } from "@/components/ui";
import { useBookingStore } from "@/store/bookingStore";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useBookingSubmit } from "@/hooks/useBookingSubmit";
import { useCmsSection } from "@/hooks/useCmsSection";
import { BookingConfirmation } from "@/components/BookingConfirmation";
import { HOME_CONTENT } from "@/constants/cms-content";

const serviceOptions = HOME_CONTENT.hero.serviceOptions;

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export function Hero() {
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
  
  const { detectLocation } = useGeolocation();
  const { submitBooking } = useBookingSubmit();
  const { data: heroCopy } = useCmsSection("home", "hero", HOME_CONTENT.hero);
  const { data: bookingCopy } = useCmsSection(
    "home",
    "hero_booking_form",
    HOME_CONTENT.hero.bookingForm,
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitStatus(null);
    
    const result = await submitBooking();
    
    if (result.success) {
      // Confirmation is now handled by confirmedBooking state
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
    <section className="relative lg:min-h-[80vh] flex items-center overflow-hidden bg-background-light py-10 lg:py-0">
      {/* Background with gradient overlay */}
      <div className="absolute inset-0 z-0">
        <div 
          className="absolute inset-0 bg-cover bg-center opacity-10 pointer-events-none"
          style={{
            backgroundImage: `url("${heroCopy.backgroundImageSrc}")`,
            filter: "grayscale(100%)",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background-light via-background-light/95 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white/50" />
      </div>

      <div className="mx-auto max-w-[1400px] w-full px-6 lg:px-12 relative z-10 pt-10 pb-16 lg:py-0">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 lg:gap-12 items-center">
          {/* Left Content */}
          <motion.div
            className="md:col-span-7 flex flex-col justify-center gap-5 lg:gap-6 md:pr-6 lg:pr-10 order-1"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {/* Badge */}
            <motion.div
              variants={itemVariants}
              className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-white/70 backdrop-blur-sm px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-primary shadow-sm"
            >
              <span className="size-2 rounded-full bg-primary animate-pulse" />
              {heroCopy.badgeText}
            </motion.div>

            {/* Heading */}
            <motion.h1
              variants={itemVariants}
              className="font-serif text-4xl sm:text-5xl lg:text-7xl font-bold leading-[1.1] tracking-tight text-text-main"
            >
              {heroCopy.headingPrefix} <br />
              <span className="italic text-transparent bg-clip-text bg-linear-to-r from-primary via-blue-500 to-indigo-500 font-light inline-block pb-2 pr-2.5">
                {heroCopy.headingHighlight}
              </span>
            </motion.h1>

            {/* Description */}
            <motion.p
              variants={itemVariants}
              className="text-lg leading-relaxed text-text-secondary/80 max-w-xl font-medium"
            >
              {heroCopy.description}
            </motion.p>

            {/* Stats */}
            <motion.div
              variants={itemVariants}
              className="flex items-center gap-6 lg:gap-8 pt-4"
            >
              <div className="flex flex-col">
                <span className="text-2xl lg:text-3xl font-bold text-text-main">{heroCopy.stats[0].value}</span>
                <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                  {heroCopy.stats[0].label}
                </span>
              </div>
              <div className="h-10 w-px bg-slate-200" />
              <div className="flex flex-col">
                <span className="text-2xl lg:text-3xl font-bold text-text-main">{heroCopy.stats[1].value}</span>
                <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                  {heroCopy.stats[1].label}
                </span>
              </div>
              <div className="h-10 w-px bg-slate-200" />
              <div className="flex flex-col">
                <span className="text-2xl lg:text-3xl font-bold text-text-main">{heroCopy.stats[2].value}</span>
                <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                  {heroCopy.stats[2].label}
                </span>
              </div>
            </motion.div>

            {/* Trust indicators */}
            <motion.div
              variants={itemVariants}
              className="flex flex-wrap items-center gap-6 mt-4"
            >
              <div className="flex -space-x-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="w-10 h-10 rounded-full border-2 border-white bg-gradient-to-br from-slate-200 to-slate-300"
                  />
                ))}
                <div className="w-10 h-10 rounded-full border-2 border-white bg-primary text-white flex items-center justify-center text-xs font-bold">
                  {heroCopy.trust.badgeLabel}
                </div>
              </div>
              <div className="text-sm font-semibold text-text-main">
                <div className="flex text-yellow-500 mb-0.5">
                  {[...Array(5)].map((_, i) => (
                    <svg key={i} className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>
                {heroCopy.trust.text}
              </div>
            </motion.div>
          </motion.div>

          {/* Right - Booking Form */}
          <motion.div
            className="md:col-span-5 lg:col-span-5 relative flex justify-center md:justify-end order-2 md:order-2"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            <div id="hero-booking-form" className="w-full max-w-sm md:max-w-md lg:max-w-lg">
              <GlassCard variant="solid" className="w-full relative p-5 sm:p-6 lg:p-8">
                {/* Show confirmation if booking exists, otherwise show form */}
                {confirmedBooking ? (
                  <BookingConfirmation 
                    booking={confirmedBooking} 
                    onBookAgain={handleBookAgain}
                    variant="card"
                  />
                ) : (
                  <>
                    {/* Verified badge */}
                    <div className="absolute top-4 right-4 text-green-500 bg-green-50 p-1.5 rounded-full">
                      <Shield className="w-4 h-4 lg:w-5 lg:h-5" />
                    </div>

                    <h3 className="text-xl lg:text-2xl font-bold text-text-main mb-0.5">
                      {bookingCopy.title}
                    </h3>
                    <p className="text-xs lg:text-sm text-text-secondary mb-4 lg:mb-6">
                      {bookingCopy.subtitle}
                    </p>

                    <form onSubmit={handleSubmit} className="space-y-3 lg:space-y-4">
                      <Input
                        label={bookingCopy.fields.patientNameLabel}
                        icon={User}
                        placeholder={bookingCopy.fields.patientNamePlaceholder}
                        value={name}
                        onChange={(e) => setDetails({ name: e.target.value })}
                        required
                      />

                      <Input
                        label={bookingCopy.fields.phoneLabel}
                        icon={Phone}
                        type="tel"
                        placeholder={bookingCopy.fields.phonePlaceholder}
                        value={phone}
                        onChange={handlePhoneChange}
                        required
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
                          {bookingCopy.fields.bookingForOtherLabel}
                        </span>
                      </label>

                      {/* Location with detect button */}
                      <div className="relative">
                        <Input
                          label={bookingCopy.fields.patientAddressLabel}
                          icon={MapPin}
                          placeholder={bookingCopy.fields.patientAddressPlaceholder}
                          value={location}
                          onChange={(e) => setDetails({ location: e.target.value })}
                          required
                        />
                        {!isBookingForOther && (
                          <button
                            type="button"
                            onClick={handleGetLocation}
                            disabled={isLocating}
                            className="absolute right-3 top-[30px] lg:top-[34px] text-xs text-primary font-medium hover:text-primary-dark transition-colors disabled:opacity-50 flex items-center gap-1"
                          >
                            {isLocating ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin" />
                                <span>{bookingCopy.geolocation.detectingLabel}</span>
                              </>
                            ) : (
                              <>
                                <Crosshair className="w-3 h-3" />
                                <span>{bookingCopy.geolocation.addGpsLabel}</span>
                              </>
                            )}
                          </button>
                        )}
                        {/* GPS Accuracy indicator */}
                        {gpsLocation && !isBookingForOther && (
                          <div className="mt-1 text-xs text-green-600 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            {bookingCopy.geolocation.gpsAddedTemplate.replace("{accuracy}", `±${gpsLocation.accuracy}m`)}
                          </div>
                        )}
                        {locationError && (
                          <div className="mt-1 text-xs text-red-500 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {locationError}
                          </div>
                        )}
                        {!gpsLocation && !locationError && !isLocating && !isBookingForOther && (
                          <div className="mt-1 text-xs text-slate-500 flex items-center gap-1">
                            <Crosshair className="w-3 h-3" />
                            {bookingCopy.geolocation.gpsOptionalNote}
                          </div>
                        )}
                        {isBookingForOther && (
                          <div className="mt-1 text-xs text-blue-600 flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {bookingCopy.geolocation.bookingForOtherNote}
                          </div>
                        )}
                      </div>

                      <Select
                        label={bookingCopy.fields.serviceTypeLabel}
                        icon={Crosshair}
                        options={serviceOptions}
                        value={serviceCategory}
                        onChange={(e) => setDetails({ serviceCategory: e.target.value })}
                      />

                      {/* Submit Status */}
                      {submitStatus && submitStatus.type === 'error' && (
                        <div className="p-3 rounded-lg text-sm flex items-center gap-2 bg-red-50 text-red-700">
                          <AlertCircle className="w-4 h-4" />
                          {submitStatus.message}
                        </div>
                      )}

                      <Button
                        type="submit"
                        variant="primary"
                        size="lg"
                        glow
                        className="w-full mt-2"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {bookingCopy.submittingLabel}
                          </>
                        ) : (
                          <>
                            {bookingCopy.ctaLabel}
                            <ArrowRight className="w-4 h-4" />
                          </>
                        )}
                      </Button>

                      <div className="text-center mt-3 lg:mt-4 flex items-center justify-center gap-1 text-xs text-gray-400">
                        <Lock className="w-3 h-3" />
                        {bookingCopy.secureNote}
                      </div>
                    </form>
                  </>
                )}
              </GlassCard>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
