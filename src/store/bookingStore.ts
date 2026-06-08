import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppliedCoupon } from '@/types/lab-coupon';
import type { ServiceSlug } from '@/lib/services/catalog';

export type GPSLocation = { lat: number; lng: number; accuracy: number };

/**
 * T85 PR4a — schedule selection. ASAP means "dispatch now"; slot means
 * the patient picked a specific 1-hour window. The slot ISO string is
 * the START of the window (e.g. "2026-06-07T10:00:00+05:30" for "10–11 AM").
 * The 30-min variance disclaimer is rendered next to the picker, not
 * stored in state.
 */
export type ScheduledFor =
  | { kind: 'asap' }
  | { kind: 'slot'; iso: string };

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
  /**
   * T85 PR4a — service-led pre-select. Seeded by
   * `requestBookingForService(slug)` before the modal opens; consumed
   * by ServiceLedBookingModal to drive the step header, the payment
   * amount, and the Step 4 WhatsApp deep link.
   *
   * `serviceCategory` (legacy) co-exists for back-compat with the lab
   * basket and the existing useBookingSubmit / Razorpay verify path;
   * during the T85 widening period both fields can hold values. The
   * new modal writes the T85 slug to bookings.service_category post
   * M039 widening.
   */
  serviceSlug: ServiceSlug | null;
  /**
   * T85 PR4a — schedule pick. Defaults to ASAP; the user may switch to
   * a 1-hour window. Cleared on resetForNewBooking.
   */
  scheduledFor: ScheduledFor;
  isBookingForOther: boolean;
  selectedTests: SelectedLabTest[];
  /** Coupon applied at the time of booking. Null until validated. */
  appliedCoupon: AppliedCoupon | null;
  confirmedBooking: ConfirmedBooking | null;
  isModalOpen: boolean;
  /** OTP-gate modal visibility (BookingGate). Independent of the booking modal. */
  isGateOpen: boolean;
  /**
   * T85 PR4b — LabBasketWindow visibility. Independent of `isModalOpen`
   * so the lab basket can co-exist (mounted but hidden) alongside the
   * non-lab ServiceLedBookingModal without interfering. Floating
   * affordances (FloatingWhatsApp, ServiceStickyBar) hide whenever any
   * of `isModalOpen | isGateOpen | isLabBasketOpen` is true.
   */
  isLabBasketOpen: boolean;
  isLocating: boolean;
  isSubmitting: boolean;
  locationError: string | null;
  /**
   * Client-side hint that the phone is OTP-verified up to this unix ms.
   * The server's HttpOnly cookie is the real source of truth; this is purely
   * to drive UI ("skip the gate, just open the form") without re-asking
   * every time the patient navigates within the site. Cleared on any 401
   * from a booking-insert response.
   */
  phoneVerifiedUntil: number | null;
  /** The E.164 phone the cookie was issued for, for prefilling forms. */
  verifiedPhone: string | null;

  setDetails: (details: Partial<BookingState>) => void;
  setGPSLocation: (gps: GPSLocation | null) => void;
  /** T85 PR4a — pre-select a service slug before opening the modal. */
  setServiceSlug: (slug: ServiceSlug | null) => void;
  /** T85 PR4a — set ASAP vs a specific 1-hour window. */
  setScheduledFor: (scheduledFor: ScheduledFor) => void;
  setBookingForOther: (value: boolean) => void;
  addSelectedTest: (test: SelectedLabTest) => void;
  removeSelectedTest: (code: string) => void;
  clearSelectedTests: () => void;
  setAppliedCoupon: (coupon: AppliedCoupon | null) => void;
  clearAppliedCoupon: () => void;
  openModal: () => void;
  closeModal: () => void;
  openGate: () => void;
  closeGate: () => void;
  /** T85 PR4b — open the LabBasketWindow (parallel to openModal). */
  openLabBasket: () => void;
  closeLabBasket: () => void;
  setLocating: (isLocating: boolean) => void;
  setSubmitting: (isSubmitting: boolean) => void;
  setLocationError: (error: string | null) => void;
  setConfirmedBooking: (booking: ConfirmedBooking | null) => void;
  clearConfirmedBooking: () => void;
  setPhoneVerified: (phone: string, untilMs: number) => void;
  clearPhoneVerified: () => void;
  reset: () => void;
  resetForNewBooking: () => void;
};

const initialState = {
  name: '',
  phone: '+91 ',
  location: '',
  gpsLocation: null as GPSLocation | null,
  serviceCategory: '',
  serviceSlug: null as ServiceSlug | null,
  scheduledFor: { kind: 'asap' } as ScheduledFor,
  isBookingForOther: false,
  selectedTests: [] as SelectedLabTest[],
  appliedCoupon: null as AppliedCoupon | null,
  confirmedBooking: null as ConfirmedBooking | null,
  isModalOpen: false,
  isGateOpen: false,
  isLabBasketOpen: false,
  isLocating: false,
  isSubmitting: false,
  locationError: null as string | null,
  phoneVerifiedUntil: null as number | null,
  verifiedPhone: null as string | null,
};

const BOOKING_EXPIRY_TIME = 30 * 60 * 1000;

export const useBookingStore = create<BookingState>()(
  persist(
    (set, get) => ({
      ...initialState,
      setDetails: (details) => set((state) => ({ ...state, ...details })),
      setGPSLocation: (gpsLocation) => set({ gpsLocation }),
      setServiceSlug: (serviceSlug) => set({ serviceSlug }),
      setScheduledFor: (scheduledFor) => set({ scheduledFor }),
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
      openGate: () => set({ isGateOpen: true }),
      closeGate: () => set({ isGateOpen: false }),
      openLabBasket: () => set({ isLabBasketOpen: true }),
      closeLabBasket: () => set({ isLabBasketOpen: false }),
      setLocating: (isLocating) => set({ isLocating }),
      setSubmitting: (isSubmitting) => set({ isSubmitting }),
      setLocationError: (locationError) => set({ locationError }),
      setConfirmedBooking: (confirmedBooking) => set({ confirmedBooking }),
      clearConfirmedBooking: () => set({ confirmedBooking: null }),
      setPhoneVerified: (phone, untilMs) =>
        set({ verifiedPhone: phone, phoneVerifiedUntil: untilMs }),
      clearPhoneVerified: () =>
        set({ verifiedPhone: null, phoneVerifiedUntil: null }),
      reset: () => set(initialState),
      resetForNewBooking: () =>
        set({
          name: '',
          phone: '+91 ',
          location: '',
          gpsLocation: null,
          serviceCategory: '',
          serviceSlug: null,
          scheduledFor: { kind: 'asap' },
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
        serviceSlug: state.serviceSlug,
        scheduledFor: state.scheduledFor,
        selectedTests: state.selectedTests,
        appliedCoupon: state.appliedCoupon,
        confirmedBooking: state.confirmedBooking,
        phoneVerifiedUntil: state.phoneVerifiedUntil,
        verifiedPhone: state.verifiedPhone,
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
