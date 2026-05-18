import { supabase, BookingInsert } from '@/lib/supabase';
import { useBookingStore } from '@/store/bookingStore';
import { useCallback } from 'react';
import { getServicePrice } from '@/constants/pricing';

// Error messages with helpful fallbacks
const ERROR_MESSAGES = {
  NETWORK: 'Unable to connect. Please check your internet and try again, or call us at +91-9571608318.',
  SERVER: 'Our servers are busy. Please try again in a moment, or call us directly at +91-9571608318.',
  VALIDATION: 'Please check your details and try again.',
  UNKNOWN: 'Something went wrong. Please call us at +91-9571608318 to complete your booking.',
};

export function useBookingSubmit() {
  const { 
    name, 
    phone, 
    location, 
    gpsLocation, 
    serviceCategory,
    isBookingForOther,
    setSubmitting,
    setConfirmedBooking,
  } = useBookingStore();

  const submitBooking = useCallback(async (): Promise<{ success: boolean; error?: string; id?: string }> => {
    // Validation
    if (!name.trim()) {
      return { success: false, error: 'Please enter patient name' };
    }
    
    // Phone validation: must be +91 followed by 10 digits
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length !== 12 || !phoneDigits.startsWith('91')) {
      return { success: false, error: 'Please enter a valid 10-digit phone number' };
    }
    
    if (!location.trim()) {
      return { success: false, error: 'Please enter the complete address' };
    }
    
    if (location.trim().length < 10) {
      return { success: false, error: 'Please enter a more detailed address for accurate service' };
    }
    
    if (!serviceCategory) {
      return { success: false, error: 'Please select a service type' };
    }

    setSubmitting(true);

    try {
      // Check if we're online before attempting
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return { success: false, error: ERROR_MESSAGES.NETWORK };
      }

      const bookingData: BookingInsert = {
        patient_name: name.trim(),
        phone: phone.trim(),
        service_category: serviceCategory,
        manual_address: location.trim(),
        gps_location: gpsLocation ? {
          lat: gpsLocation.lat,
          lng: gpsLocation.lng,
          accuracy: gpsLocation.accuracy,
        } : null,
        status: 'PENDING',
        amount: getServicePrice(serviceCategory),
      };

      // Set a timeout for the request
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('TIMEOUT')), 15000);
      });

      const supabasePromise = supabase
        .from('bookings')
        .insert(bookingData)
        .select('id')
        .single();

      const { data, error } = await Promise.race([supabasePromise, timeoutPromise]);

      if (error) {
        console.error('Supabase error:', error);
        
        // Categorize the error
        if (error.message?.includes('network') || error.message?.includes('fetch')) {
          return { success: false, error: ERROR_MESSAGES.NETWORK };
        }
        if (error.code === '42501' || error.code === '42P01') {
          return { success: false, error: ERROR_MESSAGES.SERVER };
        }
        
        return { success: false, error: ERROR_MESSAGES.SERVER };
      }

      // Save confirmed booking locally with timestamp
      setConfirmedBooking({
        id: data?.id,
        name: name.trim(),
        phone: phone.trim(),
        location: location.trim(),
        gpsLocation,
        serviceCategory,
        confirmedAt: Date.now(),
      });

      return { success: true, id: data?.id };
    } catch (err) {
      console.error('Booking submission error:', err);
      
      // Handle specific error types
      if (err instanceof Error) {
        if (err.message === 'TIMEOUT') {
          return { success: false, error: ERROR_MESSAGES.NETWORK };
        }
        if (err.message.includes('NetworkError') || err.message.includes('Failed to fetch')) {
          return { success: false, error: ERROR_MESSAGES.NETWORK };
        }
      }
      
      return { success: false, error: ERROR_MESSAGES.UNKNOWN };
    } finally {
      setSubmitting(false);
    }
  }, [name, phone, location, gpsLocation, serviceCategory, isBookingForOther, setSubmitting, setConfirmedBooking]);

  return { submitBooking };
}
