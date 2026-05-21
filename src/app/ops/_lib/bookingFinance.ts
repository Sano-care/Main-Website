// Helpers for computing booking amounts + payment classification.
//
// The bookings mega-table has multiple "amount" columns added over time:
//   - amount                  (legacy, integer rupees, set on homecare flow)
//   - booking_fee_paid_paise  (homecare initial fee, paise)
//   - balance_paid_paise      (homecare balance, paise)
//   - test_total_paise        (lab pre-discount, paise)
//   - final_amount_paise      (lab post-coupon, paise)
//
// Two payment-status columns:
//   - payment_status         (CREATED|CAPTURED|FAILED|REFUNDED|PARTIAL_REFUND)
//   - report_payment_status  (NULL|NOT_DUE|LINK_SENT|CAPTURED|REFUNDED)
//
// The functions below codify a single, consistent way to read all of this.

export type BookingFinanceInput = {
  status: string;
  amount: number | null;
  final_amount_paise: number | null;
  test_total_paise: number | null;
  booking_fee_paid_paise: number | null;
  balance_paid_paise: number | null;
  payment_status: string | null;
  report_payment_status: string | null;
};

/**
 * Single "headline amount" for a booking, in rupees. Picks the most
 * specific source available, falling back through legacy columns.
 */
export function bookingAmountRupees(b: BookingFinanceInput): number {
  if (b.final_amount_paise != null) return b.final_amount_paise / 100;
  if (b.test_total_paise != null) return b.test_total_paise / 100;
  if (b.amount != null) return b.amount;
  const paise = (b.booking_fee_paid_paise ?? 0) + (b.balance_paid_paise ?? 0);
  if (paise > 0) return paise / 100;
  return 0;
}

export type PaymentClass =
  | "collected" // money is in
  | "outstanding" // money is owed
  | "refunded" // money came back
  | "cancelled_unpaid"; // booking dead before any payment

/**
 * Classify a booking's payment state for aggregation. Order matters:
 * refunds dominate (we don't count refunded money as collected), and
 * capture on either of the two payment lanes (booking fee OR lab report)
 * counts as "collected".
 */
export function classifyBookingPayment(b: BookingFinanceInput): PaymentClass {
  const refunded =
    b.payment_status === "REFUNDED" ||
    b.payment_status === "PARTIAL_REFUND" ||
    b.report_payment_status === "REFUNDED";
  if (refunded) return "refunded";

  const captured =
    b.payment_status === "CAPTURED" || b.report_payment_status === "CAPTURED";
  if (captured) return "collected";

  if (b.status === "CANCELLED") return "cancelled_unpaid";

  return "outstanding";
}
