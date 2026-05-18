import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppliedCoupon } from '@/types/lab-coupon';

export type GPSLocation = { lat: number; lng: number; accuracy: number };

export type SelectedLabTest = {
  code: string;
  name: string;
  price: number;
  sample?: string;
  tat?: string;
  category?: string;
};

export type ConfirmedBooking = {
  id?: string;
  name: string;
  phone: string;
  location: string;
  gpsLocation: GPSLocation | null;
  serviceCategory: string;
  selectedTests?: SelectedLabTest[];
  appliedCoupon?: AppliedCoupon | null;
  confirmedAt: number;
};

export type BookingState = {
  name: string;
  phone: string;
  location: string;
  gpsLocation: GPSLocation | null;
  serviceCategory: string;
  isBookingForOther: boolean;
  selectedTests: SelectedLabTest[];
  /** Coupon applied at the time of booking. Null until validated. */
  appliedCoupon: AppliedCoupon | null;
  confirmedBooking: ConfirmedBooking | null;
  isModalOpen: boolean;
  isLocating: boolean;
  isSubmitting: boolean;
  locationError: string | null;

  setDetails: (details: Partial<BookingState>) => void;
  setGPSLocation: (gps: GPSLocation | null) => void;
  setBookingForOther: (value: boolean) => void;
  addSelectedTest: (test: SelectedLabTest) => void;
  removeSelectedTest: (code: string) => void;
  clearSelectedTests: () => void;
  setAppliedCoupon: (coupon: AppliedCoupon | null) => void;
  clearAppliedCoupon: () => void;
  openModal: () => void;
  closeModal: () => void;
  setLocating: (isLocating: boolean) => void;
  setSubmitting: (isSubmitting: boolean) => void;
  setLocationError: (error: string | null) => void;
  setConfirmedBooking: (booking: ConfirmedBooking | null) => void;
  clearConfirmedBooking: () => void;
  reset: () => void;
  resetForNewBooking: () => void;
};

const initialState = {
  name: '',
  phone: '+91 ',
  location: '',
  gpsLocation: null as GPSLocation | null,
  serviceCategory: '',
  isBookingForOther: false,
  selectedTests: [] as SelectedLabTest[],
  appliedCoupon: null as AppliedCoupon | null,
  confirmedBooking: null as ConfirmedBooking | null,
  isModalOpen: false,
  isLocating: false,
  isSubmitting: false,
  locationError: null as string | null,
};

const BOOKING_EXPIRY_TIME = 30 * 60 * 1000;

export const useBookingStore = create<BookingState>()(
  persist(
    (set, get) => ({
      ...initialState,
      setDetails: (details) => set((state) => ({ ...state, ...details })),
      setGPSLocation: (gpsLocation) => set({ gpsLocation }),
      setBookingForOther: (isBookingForOther) =>
        set({
          isBookingForOther,
          gpsLocation: isBookingForOther ? null : get().gpsLocation,
        }),
      addSelectedTest: (test) =>
        set((state) => {
          if (state.selectedTests.some((t) => t.code === test.code)) return state;
          // Clear coupon when basket changes — patient must re-apply
          return {
            selectedTests: [...state.selectedTests, test],
            appliedCoupon: null,
          };
        }),
      removeSelectedTest: (code) =>
        set((state) => ({
          selectedTests: state.selectedTests.filter((t) => t.code !== code),
          appliedCoupon: null, // basket changed, force re-apply
        })),
      clearSelectedTests: () => set({ selectedTests: [], appliedCoupon: null }),
      setAppliedCoupon: (appliedCoupon) => set({ appliedCoupon }),
      clearAppliedCoupon: () => set({ appliedCoupon: null }),
      openModal: () => set({ isModalOpen: true }),
      closeModal: () => set({ isModalOpen: false }),
      setLocating: (isLocating) => set({ isLocating }),
      setSubmitting: (isSubmitting) => set({ isSubmitting }),
      setLocationError: (locationError) => set({ locationError }),
      setConfirmedBooking: (confirmedBooking) => set({ confirmedBooking }),
      clearConfirmedBooking: () => set({ confirmedBooking: null }),
      reset: () => set(initialState),
      resetForNewBooking: () =>
        set({
          name: '',
          phone: '+91 ',
          location: '',
          gpsLocation: null,
          serviceCategory: '',
          isBookingForOther: false,
          selectedTests: [],
          appliedCoupon: null,
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
        selectedTests: state.selectedTests,
        appliedCoupon: state.appliedCoupon,
        confirmedBooking: state.confirmedBooking,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.confirmedBooking) {
          const elapsed = Date.now() - state.confirmedBooking.confirmedAt;
          if (elapsed > BOOKING_EXPIRY_TIME) {
            state.confirmedBooking = null;
            state.selectedTests = [];
            state.appliedCoupon = null;
          }
        }
      },
    }
  )
);
