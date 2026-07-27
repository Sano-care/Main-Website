import type { BookingStatus } from "@/app/ops/_lib/bookingStatus";

// Worklist triage model — the founder runs ops from his phone, so the bookings
// list is a to-do triage, not a flat ledger. Three sections in a DELIBERATE,
// fixed order; each booking gets ONE primary action matching its current stage.
//
// Section order is a hard requirement and must not change:
//   1. Needs assignment  → paid, waiting for a medic / doctor / phlebotomist
//   2. In flight         → assigned, being fulfilled right now
//   3. Balance outstanding → money still to collect
//
// Bookings that are fully done (COMPLETED + paid, REPORT_DELIVERED, CANCELLED)
// drop out of the default triage — they're still reachable via search/filter.
//
// The status→section and status→action maps live here (pure, unit-tested) so the
// founder can retune the buckets in one place without touching the UI.

export type WorklistSection =
  | "needs_assignment"
  | "in_flight"
  | "balance_outstanding";

export const WORKLIST_SECTION_ORDER: readonly WorklistSection[] = [
  "needs_assignment",
  "in_flight",
  "balance_outstanding",
] as const;

export const WORKLIST_SECTION_META: Record<
  WorklistSection,
  { title: string; blurb: string }
> = {
  needs_assignment: {
    title: "Needs assignment",
    blurb: "Paid — waiting for a medic, doctor, or phlebotomist.",
  },
  in_flight: {
    title: "In flight",
    blurb: "Assigned and being fulfilled right now.",
  },
  balance_outstanding: {
    title: "Balance outstanding",
    blurb: "Money still to collect.",
  },
};

export interface WorklistBooking {
  status: BookingStatus;
  service_category: string | null;
  booking_fee_paid_paise: number | null;
  balance_paid_paise: number | null;
}

const NEEDS_ASSIGNMENT = new Set<BookingStatus>([
  "PENDING",
  "CONFIRMED",
  "PENDING_COLLECTION",
]);

const IN_FLIGHT = new Set<BookingStatus>([
  "DISPATCHED",
  "IN_PROGRESS",
  "COLLECTED",
  "AT_LAB",
  "REPORT_READY",
]);

function isLab(service: string | null): boolean {
  return service === "diagnostics";
}

/**
 * A non-lab visit that finished but whose cash-at-door balance hasn't been
 * logged yet: an advance was captured (booking_fee_paid_paise > 0) but the
 * balance line is still empty. This is the homecare/nursing 50%-advance tail.
 */
function hasUnrecordedDoorBalance(b: WorklistBooking): boolean {
  if (isLab(b.service_category)) return false;
  if (b.status !== "COMPLETED") return false;
  const advanceTaken = (b.booking_fee_paid_paise ?? 0) > 0;
  const balanceLogged = (b.balance_paid_paise ?? 0) > 0;
  return advanceTaken && !balanceLogged;
}

/**
 * Which triage section a booking belongs to, or null when it's done/dead and
 * should fall out of the worklist. Balance-outstanding is checked first so an
 * AWAITING_PAYMENT lab or a completed-but-unbalanced visit surfaces as "collect
 * money" rather than getting lost.
 */
export function bookingSection(b: WorklistBooking): WorklistSection | null {
  if (b.status === "AWAITING_PAYMENT") return "balance_outstanding";
  if (hasUnrecordedDoorBalance(b)) return "balance_outstanding";
  if (NEEDS_ASSIGNMENT.has(b.status)) return "needs_assignment";
  if (IN_FLIGHT.has(b.status)) return "in_flight";
  return null;
}

export type PrimaryAction =
  // A one-tap status transition, done optimistically in the card.
  | { kind: "transition"; label: string; nextStatus: BookingStatus }
  // Navigates to the booking detail, where the richer form lives (assignment
  // needs a target picker; payment recording is sensitive).
  | { kind: "link"; label: string };

/**
 * The single primary action for a booking's current stage. One action, matched
 * to the stage — never a menu of every possible action.
 */
export function primaryAction(status: BookingStatus): PrimaryAction {
  switch (status) {
    case "PENDING":
    case "CONFIRMED":
      return { kind: "link", label: "Assign" };
    case "PENDING_COLLECTION":
      return { kind: "link", label: "Assign phlebotomist" };
    case "DISPATCHED":
      return { kind: "transition", label: "Mark in progress", nextStatus: "IN_PROGRESS" };
    case "IN_PROGRESS":
      return { kind: "transition", label: "Mark completed", nextStatus: "COMPLETED" };
    case "COLLECTED":
      return { kind: "transition", label: "Mark at lab", nextStatus: "AT_LAB" };
    case "AT_LAB":
      return { kind: "transition", label: "Mark report ready", nextStatus: "REPORT_READY" };
    case "REPORT_READY":
      return { kind: "link", label: "Deliver report" };
    case "AWAITING_PAYMENT":
      return { kind: "link", label: "Record payment" };
    case "COMPLETED":
      return { kind: "link", label: "Record balance" };
    default:
      return { kind: "link", label: "Open" };
  }
}
