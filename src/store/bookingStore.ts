import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppliedCoupon } from '@/types/lab-coupon';
import type { ServiceSlug } from '@/lib/services/catalog';
import type { FamilyMember } from '@/lib/family-members/types';

/**
 * T90 Slice 2 Step 12 — booking-flow entry-point provenance.
 *
 * The four bookingStore-driven overlays are now mounted in TWO trees
 * (Navbar for marketing, PulseChrome for /pulse). When a booking is
 * dispatched, the modal needs to know which tree triggered it so the
 * Step 0 MemberConfirmStep only shows for Pulse-side bookings. Stored
 * here rather than prop-drilled through BookingFlowMounts because the
 * trigger component (PulseHomeTiles, etc.) owns the value, not the
 * mount-site component.
 *
 * 'marketing' is the default — Navbar / ServiceSection / etc. don't
 * need to set it. Pulse triggers explicitly set 'pulse' before dispatch.
 *
 * Reset in closeModal / closeLabBasket / closeGate (NOT persisted)
 * so a marketing visit from the same browser doesn't inherit Pulse state.
 */
export type EntryPoint = 'marketing' | 'pulse';

/**
 * T90 Slice 2 Step 12 — who the Pulse booking is for.
 *
 * `null` = no Pulse context (marketing entry, or Pulse entry hasn't
 * resolved viewing-state yet).
 * `{ kind: 'self' }` = explicit "Booking for yourself" — caregiver
 * is themselves the patient. Modal hides chevron + Change link.
 * `{ kind: 'member', member }` = "Booking for {member.name}" — the
 * caregiver is booking on behalf of a family member. Modal shows
 * the relation line + age + Change link, populates patient_name +
 * member_id from `member`.
 *
 * Reset alongside entryPoint.
 */
export type PulseEntryMember =
  | { kind: 'self' }
  | { kind: 'member'; member: FamilyMember };

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
  /**
   * T64: full_name read from `customers` for the verified phone, returned
   * by /api/auth/verify-otp on success. Used to pre-fill the name input
   * in IdentifyStep + LabBasketWindow so returning patients don't re-type
   * their name on every booking. Null when the phone is new (no customers
   * row yet) — the auto-upsert path leaves full_name NULL until the
   * patient types it. Cleared on clearPhoneVerified (same lifecycle as
   * verifiedPhone).
   */
  verifiedFullName: string | null;
  /**
   * T90 Slice 2 Step 12 — entryPoint provenance + Pulse booking subject.
   * Both are session-only (NOT persisted) and reset on closeModal /
   * closeLabBasket / closeGate so the next booking starts clean.
   */
  entryPoint: EntryPoint;
  pulseEntryMember: PulseEntryMember | null;

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
  setPhoneVerified: (
    phone: string,
    untilMs: number,
    fullName?: string | null,
  ) => void;
  clearPhoneVerified: () => void;
  /** T90 Slice 2 Step 12 — set provenance before dispatching a booking. */
  setEntryPoint: (entryPoint: EntryPoint) => void;
  /** T90 Slice 2 Step 12 — set Pulse booking subject (self vs family member). */
  setPulseEntryMember: (m: PulseEntryMember | null) => void;
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
  verifiedFullName: null as string | null,
  entryPoint: 'marketing' as EntryPoint,
  pulseEntryMember: null as PulseEntryMember | null,
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
      // T90 Slice 2 Step 12 — reset Pulse provenance on every close.
      // Hygiene: the next dispatch (could be a different surface, even
      // a different user on a shared browser) must start clean.
      closeModal: () =>
        set({
          isModalOpen: false,
          entryPoint: 'marketing',
          pulseEntryMember: null,
        }),
      openGate: () => set({ isGateOpen: true }),
      closeGate: () =>
        set({
          isGateOpen: false,
          entryPoint: 'marketing',
          pulseEntryMember: null,
        }),
      openLabBasket: () => set({ isLabBasketOpen: true }),
      closeLabBasket: () =>
        set({
          isLabBasketOpen: false,
          entryPoint: 'marketing',
          pulseEntryMember: null,
        }),
      setLocating: (isLocating) => set({ isLocating }),
      setSubmitting: (isSubmitting) => set({ isSubmitting }),
      setLocationError: (locationError) => set({ locationError }),
      setConfirmedBooking: (confirmedBooking) => set({ confirmedBooking }),
      clearConfirmedBooking: () => set({ confirmedBooking: null }),
      setPhoneVerified: (phone, untilMs, fullName) =>
        set({
          verifiedPhone: phone,
          phoneVerifiedUntil: untilMs,
          // Only overwrite verifiedFullName when an explicit value is
          // passed. `undefined` (the old 2-arg call shape) preserves
          // whatever was there — callers that don't know about T64 stay
          // back-compatible.
          ...(fullName !== undefined ? { verifiedFullName: fullName } : {}),
        }),
      clearPhoneVerified: () =>
        set({
          verifiedPhone: null,
          phoneVerifiedUntil: null,
          verifiedFullName: null,
        }),
      setEntryPoint: (entryPoint) => set({ entryPoint }),
      setPulseEntryMember: (pulseEntryMember) => set({ pulseEntryMember }),
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
          entryPoint: 'marketing',
          pulseEntryMember: null,
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
        verifiedFullName: state.verifiedFullName,
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
