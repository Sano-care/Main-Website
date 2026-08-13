// Booking status enum — must match the CHECK constraint in migration 008.
// Anything outside this list will be rejected by Postgres on UPDATE.

export const BOOKING_STATUSES = [
  // Homecare / nursing / teleconsult lifecycle
  "PENDING",
  "CONFIRMED",
  "DISPATCHED",
  "IN_PROGRESS",
  "COMPLETED",
  // Lab home-collection lifecycle
  "PENDING_COLLECTION",
  "COLLECTED",
  "AT_LAB",
  "REPORT_READY",
  "AWAITING_PAYMENT",
  "REPORT_DELIVERED",
  // Terminal: applies to either lifecycle
  "CANCELLED",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export function isBookingStatus(v: unknown): v is BookingStatus {
  return typeof v === "string" && (BOOKING_STATUSES as readonly string[]).includes(v);
}

export const STATUS_STYLE: Record<BookingStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  CONFIRMED: "bg-blue-100 text-blue-800",
  DISPATCHED: "bg-indigo-100 text-indigo-800",
  IN_PROGRESS: "bg-purple-100 text-purple-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  PENDING_COLLECTION: "bg-amber-100 text-amber-800",
  COLLECTED: "bg-blue-100 text-blue-800",
  AT_LAB: "bg-purple-100 text-purple-800",
  REPORT_READY: "bg-cyan-100 text-cyan-800",
  AWAITING_PAYMENT: "bg-rose-100 text-rose-800",
  REPORT_DELIVERED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-slate-200 text-slate-700",
};

export const PAYMENT_STATUS_STYLE: Record<string, string> = {
  CREATED: "bg-slate-100 text-slate-700",
  CAPTURED: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-rose-100 text-rose-800",
  REFUNDED: "bg-amber-100 text-amber-800",
  PARTIAL_REFUND: "bg-amber-100 text-amber-800",
  // report_payment_status values
  NOT_DUE: "bg-slate-100 text-slate-700",
  LINK_SENT: "bg-blue-100 text-blue-800",
};

// Service categories — the ONLY valid service vocabulary (founder decision,
// migration 20260725150000). Exactly the 4 canonical T85 slugs; every legacy
// value (homecare / teleconsult / chronic / nursing / diagnostics / lab /
// "Home visit") is retired and renamed, and the DB CHECK now rejects them.
export const SERVICE_CATEGORIES = [
  "home-visit",
  "teleconsultation",
  "lab-tests",
  "medic-at-home",
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

/** Human labels for the 4 services (ops New-Booking dropdown, etc.). */
export const SERVICE_CATEGORY_LABELS: Record<ServiceCategory, string> = {
  "home-visit": "Home Visit",
  teleconsultation: "Teleconsultation",
  "lab-tests": "Lab Tests",
  "medic-at-home": "Medic at Home",
};
