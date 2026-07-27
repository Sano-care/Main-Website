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

// Service categories accepted when ops creates a booking.
//
// Two generations coexist (the DB CHECK was widened in M039 to accept
// both, and existing rows use either):
//   - legacy (migration 003): homecare, teleconsult, chronic, diagnostics
//   - T85 slugs the website actually writes today (and the most-sold
//     services): medic-at-home, home-visit, teleconsultation, lab-tests
//
// Both are listed so ops can create a booking for the current services
// (27 of the last 30 days are 'medic-at-home') while legacy values stay
// valid for historical rows. NOTE: createBooking's teleconsult/diagnostics
// special-casing keys on the LEGACY values ('teleconsult'/'diagnostics'),
// so picking the T85 'teleconsultation'/'lab-tests' slug creates a plain
// PENDING booking without the session/lab-basket seeding — see the PR note.
export const SERVICE_CATEGORIES = [
  // legacy
  "homecare",
  "teleconsult",
  "chronic",
  "diagnostics",
  // T85 slugs (website + most-sold)
  "medic-at-home",
  "home-visit",
  "teleconsultation",
  "lab-tests",
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];
