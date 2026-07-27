import { describe, it, expect } from "vitest";

import { bookingSection, primaryAction, type WorklistBooking } from "../worklist";

const base: WorklistBooking = {
  status: "CONFIRMED",
  service_category: "homecare",
  booking_fee_paid_paise: null,
  balance_paid_paise: null,
};

describe("bookingSection", () => {
  it("routes new paid bookings to Needs assignment", () => {
    expect(bookingSection({ ...base, status: "CONFIRMED" })).toBe("needs_assignment");
    expect(bookingSection({ ...base, status: "PENDING" })).toBe("needs_assignment");
    expect(
      bookingSection({ ...base, status: "PENDING_COLLECTION", service_category: "diagnostics" }),
    ).toBe("needs_assignment");
  });

  it("routes active fulfilment to In flight", () => {
    for (const s of ["DISPATCHED", "IN_PROGRESS", "COLLECTED", "AT_LAB", "REPORT_READY"] as const) {
      expect(bookingSection({ ...base, status: s })).toBe("in_flight");
    }
  });

  it("routes AWAITING_PAYMENT to Balance outstanding", () => {
    expect(
      bookingSection({ ...base, status: "AWAITING_PAYMENT", service_category: "diagnostics" }),
    ).toBe("balance_outstanding");
  });

  it("routes a completed non-lab visit with an unlogged door balance to Balance outstanding", () => {
    expect(
      bookingSection({
        status: "COMPLETED",
        service_category: "homecare",
        booking_fee_paid_paise: 25000,
        balance_paid_paise: null,
      }),
    ).toBe("balance_outstanding");
  });

  it("drops fully-settled and dead bookings out of triage", () => {
    // completed non-lab with the balance recorded
    expect(
      bookingSection({
        status: "COMPLETED",
        service_category: "homecare",
        booking_fee_paid_paise: 25000,
        balance_paid_paise: 25000,
      }),
    ).toBeNull();
    // lab lifecycle end + cancelled
    expect(
      bookingSection({ ...base, status: "REPORT_DELIVERED", service_category: "diagnostics" }),
    ).toBeNull();
    expect(bookingSection({ ...base, status: "CANCELLED" })).toBeNull();
  });

  it("does not treat a lab booking as having a door balance", () => {
    expect(
      bookingSection({
        status: "COMPLETED",
        service_category: "diagnostics",
        booking_fee_paid_paise: 20000,
        balance_paid_paise: null,
      }),
    ).toBeNull();
  });
});

describe("primaryAction", () => {
  it("advances in-flight stages one step, optimistically", () => {
    expect(primaryAction("DISPATCHED")).toEqual({
      kind: "transition",
      label: "Mark in progress",
      nextStatus: "IN_PROGRESS",
    });
    expect(primaryAction("IN_PROGRESS")).toEqual({
      kind: "transition",
      label: "Mark completed",
      nextStatus: "COMPLETED",
    });
    expect(primaryAction("AT_LAB")).toEqual({
      kind: "transition",
      label: "Mark report ready",
      nextStatus: "REPORT_READY",
    });
  });

  it("uses link actions for assignment + payment (need a detail form)", () => {
    expect(primaryAction("CONFIRMED").kind).toBe("link");
    expect(primaryAction("PENDING_COLLECTION").kind).toBe("link");
    expect(primaryAction("AWAITING_PAYMENT").kind).toBe("link");
    expect(primaryAction("COMPLETED").kind).toBe("link");
  });
});
