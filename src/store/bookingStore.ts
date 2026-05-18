import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type GPSLocation = {
  lat: number;
  lng: number;
  accuracy: number; // in meters
};

export type ConfirmedBooking = {
  id?: string;
  name: string;
  phone: string;
  location: string;
  gpsLocation: GPSLocation | null;
  serviceCategory: string;
  confirmedAt: number; // timestamp
};

export type BookingState = {
  // Form Details
  name: string;
  phone: string;
  location: string; // Manual typed location
  gpsLocation: GPSLocation | null; // Precise GPS coordinates
  serviceCategory: string;
  isBookingForOther: boolean; // Booking for someone else
  
  // Confirmed booking (shown after success)
  confirmedBooking: ConfirmedBooking | null;
  
  // UI State
  isModalOpen: boolean;
  isLocating: boolean;
  isSubmitting: boolean;
  locationError: string | null;
  
  // Actions
  setDetails: (details: Partial<BookingState>) => void;
  setGPSLocation: (gps: GPSLocation | null) => void;
  setBookingForOther: (value: boolean) => void;
  openModal: () => void;
  closeModal: () => void;
  setLocating: (isLocating: boolean) => void;
  setSubmitting: (isSubmitting: boolean) => void;
  setLocationError: (error: string | null) => void;
  setConfirmedBooking: (booking: ConfirmedBooking | null) => void;
  clearConfirmedBooking: () => void;
  reset: () => void;
  resetForNewBooking: () => void; // Reset form but keep confirmation logic
};

const initialState = {
  name: '',
  phone: '+91 ',
  location: '',
  gpsLocation: null as GPSLocation | null,
  serviceCategory: '',
  isBookingForOther: false,
  confirmedBooking: null as ConfirmedBooking | null,
  isModalOpen: false,
  isLocating: false,
  isSubmitting: false,
  locationError: null as string | null,
};

// 30 minutes in milliseconds
const BOOKING_EXPIRY_TIME = 30 * 60 * 1000;

export const useBookingStore = create<BookingState>()(
  persist(
    (set, get) => ({
      ...initialState,
      setDetails: (details) => set((state) => ({ ...state, ...details })),
      setGPSLocation: (gpsLocation) => set({ gpsLocation }),
      setBookingForOther: (isBookingForOther) => set({ isBookingForOther, gpsLocation: isBookingForOther ? null : get().gpsLocation }),
      openModal: () => set({ isModalOpen: true }),
      closeModal: () => set({ isModalOpen: false }),
      setLocating: (isLocating) => set({ isLocating }),
      setSubmitting: (isSubmitting) => set({ isSubmitting }),
      setLocationError: (locationError) => set({ locationError }),
      setConfirmedBooking: (confirmedBooking) => set({ confirmedBooking }),
      clearConfirmedBooking: () => set({ confirmedBooking: null }),
      reset: () => set(initialState),
      resetForNewBooking: () => set({
        name: '',
        phone: '+91 ',
        location: '',
        gpsLocation: null,
        serviceCategory: '',
        isBookingForOther: false,
        confirmedBooking: null,
        isLocating: false,
        isSubmitting: false,
        locationError: null,
      }),
    }),
    { 
      name: 'sano-booking-storage',
      partialize: (state) => ({
        name: state.name,
        phone: state.phone,
        location: state.location,
        serviceCategory: state.serviceCategory,
        confirmedBooking: state.confirmedBooking,
        // Don't persist GPS as it should be fresh each session
      }),
      onRehydrateStorage: () => (state) => {
        // Check if confirmed booking has expired (30 min)
        if (state?.confirmedBooking) {
          const elapsed = Date.now() - state.confirmedBooking.confirmedAt;
          if (elapsed > BOOKING_EXPIRY_TIME) {
            state.confirmedBooking = null;
          }
        }
      },
    }
  )
);

