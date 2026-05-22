// Single shared refund implementation. Both code paths use this:
//   - /api/razorpay/refund (legacy token-protected route — kept for
//     existing scripts / Postman; flagged for M7 hardening review)
//   - /ops/payments admin action (new in M3, gated by is_ops_admin())
//
// Caller is responsible for authorising the refund (token check or
// is_ops_admin() check). This function then enforces the universal rules:
//
//   1. The booking must exist and the chosen payment lane must have a
//      captured Razorpay payment.
//   2. The requested amount (or "full" if omitted) must not exceed the
//      remaining refundable balance = captured − sum(processed refunds).
//   3. The Razorpay refund API is called server-side with the secret key.
//   4. A refunds row is upserted by razorpay_refund_id (so a concurrent
//      webhook delivery for the same id collapses cleanly).
//   5. The legacy bookings columns (refund_id, refunded_at,
//      refund_amount_paise, payment_status / report_payment_status) are
//      kept in sync — important for the /ops/lab page + any other
//      consumer still reading inline payment state on bookings.
//
// All DB writes use a service-role client. The function never reads or
// writes through an authenticated session — that's the caller's job
// (auth lives outside; data writes live inside).

import type { SupabaseClient } from "@supabase/supabase-js";
import { getRazorpayClient } from "@/lib/razorpay";

export type PaymentKind = "booking_fee" | "report_fee";

export type IssueRefundInput = {
  bookingId: string;
  paymentKind: PaymentKind;
  /** Reason recorded in Razorpay notes + on the refunds row. */
  reason?: string | null;
  /** If omitted/null, refund the full remaining balance. */
  partialAmountPaise?: number | null;
  /** Ops user id for created_by. NULL for token-route / webhook origins. */
  opsUserId?: string | null;
};

export type IssueRefundResult = {
  refundId: string;
  refundedAmountPaise: number;
  isPartial: boolean;
  /** What the refunds row was upserted to. */
  refundStatus: "pending" | "processed";
};

/**
 * Friendly error type so callers can surface clean messages to the UI
 * (the ops admin path needs that; the token route just JSON.stringifies).
 */
export class RefundError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "booking_not_found"
      | "lane_not_captured"
      | "no_refundable_balance"
      | "exceeds_refundable"
      | "razorpay_failed"
      | "db_write_failed",
  ) {
    super(message);
    this.name = "RefundError";
  }
}

/**
 * Issue a refund end-to-end. See module header for the contract.
 *
 * @param supabase service-role client (bypasses RLS).
 * @param input    booking + lane + amount + attribution.
 */
export async function issueRefund(
  supabase: SupabaseClient,
  input: IssueRefundInput,
): Promise<IssueRefundResult> {
  // ---- 1. Fetch the booking + figure out the lane ----
  const { data: booking, error: fetchErr } = await supabase
    .from("bookings")
    .select(
      `id, service_category,
       razorpay_payment_id, payment_status, booking_fee_paid_paise, amount,
       report_razorpay_payment_id, report_payment_status, final_amount_paise, test_total_paise`,
    )
    .eq("id", input.bookingId)
    .maybeSingle();

  if (fetchErr || !booking) {
    throw new RefundError(
      `Booking ${input.bookingId} not found.`,
      "booking_not_found",
    );
  }

  const lane = laneFor(input.paymentKind, booking);
  if (!lane.razorpayPaymentId) {
    throw new RefundError(
      `No captured ${input.paymentKind === "booking_fee" ? "booking-fee" : "report-fee"} payment on this booking — nothing to refund.`,
      "lane_not_captured",
    );
  }

  // ---- 2. Compute refundable balance: captured − sum(processed) ----
  const { data: priorRefunds } = await supabase
    .from("refunds")
    .select("amount_paise, status")
    .eq("booking_id", input.bookingId)
    .eq("payment_kind", input.paymentKind);
  const alreadyRefundedPaise = (priorRefunds ?? [])
    .filter((r) => r.status === "processed" || r.status === "pending")
    .reduce((s, r) => s + (r.amount_paise ?? 0), 0);
  const refundablePaise = lane.capturedPaise - alreadyRefundedPaise;
  if (refundablePaise <= 0) {
    throw new RefundError(
      "Nothing left to refund — the captured amount is already fully refunded.",
      "no_refundable_balance",
    );
  }

  // ---- 3. Resolve requested amount ----
  let refundPaise = refundablePaise;
  if (
    typeof input.partialAmountPaise === "number" &&
    input.partialAmountPaise > 0
  ) {
    if (input.partialAmountPaise > refundablePaise) {
      throw new RefundError(
        `Requested ₹${input.partialAmountPaise / 100} exceeds the remaining refundable balance of ₹${refundablePaise / 100}.`,
        "exceeds_refundable",
      );
    }
    refundPaise = input.partialAmountPaise;
  }

  // ---- 4. Call Razorpay ----
  let razorpayResp: { id: string; status?: string };
  try {
    const razorpay = getRazorpayClient();
    const refund = await razorpay.payments.refund(lane.razorpayPaymentId, {
      amount: refundPaise,
      speed: "normal",
      notes: {
        booking_id: input.bookingId,
        payment_kind: input.paymentKind,
        reason: input.reason || "Sanocare ops refund",
      },
    });
    razorpayResp = { id: String(refund.id), status: refund.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new RefundError(`Razorpay refund failed: ${msg}`, "razorpay_failed");
  }

  // Razorpay's refund status: 'pending' | 'processed' | 'failed'.
  // 'failed' would have thrown above; we map the rest 1:1.
  const refundStatus: "pending" | "processed" =
    razorpayResp.status === "processed" ? "processed" : "pending";

  // ---- 5. Upsert the refunds row ----
  // If the webhook beat us here, this UPDATE-on-conflict reconciles
  // amount / status / created_by onto the existing row.
  const { error: refundsErr } = await supabase
    .from("refunds")
    .upsert(
      {
        razorpay_refund_id: razorpayResp.id,
        booking_id: input.bookingId,
        payment_kind: input.paymentKind,
        amount_paise: refundPaise,
        status: refundStatus,
        reason: input.reason || null,
        created_by: input.opsUserId ?? null,
      },
      { onConflict: "razorpay_refund_id" },
    );
  if (refundsErr) {
    // Refund is already at Razorpay — log loudly and let the caller surface
    // the divergence. The webhook will eventually reconcile when delivery
    // events fire, but this is a real correctness alert.
    console.error(
      "[issueRefund] CRITICAL: Razorpay refund created but refunds upsert failed",
      { refundId: razorpayResp.id, bookingId: input.bookingId, refundsErr },
    );
    throw new RefundError(
      `Refund ${razorpayResp.id} created at Razorpay but the refunds row failed to save: ${refundsErr.message}. Reconcile manually.`,
      "db_write_failed",
    );
  }

  // ---- 6. Keep the legacy bookings columns in sync ----
  // /ops/lab and the existing webhook code read these — important to
  // mirror the new refund state until those readers are migrated to
  // payments_v + refunds in a later milestone.
  const newPaymentStatus =
    refundPaise < lane.capturedPaise ? "PARTIAL_REFUND" : "REFUNDED";
  const updates: Record<string, unknown> = {
    refund_id: razorpayResp.id,
    refunded_at: new Date().toISOString(),
    refund_amount_paise: refundPaise,
  };
  if (input.paymentKind === "booking_fee") {
    updates.payment_status = newPaymentStatus;
  } else {
    updates.report_payment_status = newPaymentStatus;
  }
  const { error: bookingsErr } = await supabase
    .from("bookings")
    .update(updates)
    .eq("id", input.bookingId);
  if (bookingsErr) {
    // Refund is at Razorpay AND in our refunds table; only the legacy
    // bookings mirror failed. Less critical (payments_v will still show
    // the refund via the new table once we move readers over), but worth
    // logging.
    console.error(
      "[issueRefund] bookings legacy-mirror update failed",
      { refundId: razorpayResp.id, bookingId: input.bookingId, bookingsErr },
    );
  }

  return {
    refundId: razorpayResp.id,
    refundedAmountPaise: refundPaise,
    isPartial: refundPaise < lane.capturedPaise,
    refundStatus,
  };
}

// =====================================================================
// Helpers
// =====================================================================

type BookingForRefund = {
  service_category: string | null;
  razorpay_payment_id: string | null;
  payment_status: string | null;
  booking_fee_paid_paise: number | null;
  amount: number | null;
  report_razorpay_payment_id: string | null;
  report_payment_status: string | null;
  final_amount_paise: number | null;
  test_total_paise: number | null;
};

function laneFor(
  kind: PaymentKind,
  b: BookingForRefund,
): { razorpayPaymentId: string | null; capturedPaise: number } {
  if (kind === "booking_fee") {
    return {
      razorpayPaymentId:
        b.payment_status === "CAPTURED" ||
        b.payment_status === "PARTIAL_REFUND" ||
        b.payment_status === "REFUNDED"
          ? b.razorpay_payment_id
          : null,
      capturedPaise:
        b.booking_fee_paid_paise ?? (b.amount != null ? b.amount * 100 : 0),
    };
  }
  // report_fee
  return {
    razorpayPaymentId:
      b.report_payment_status === "CAPTURED" ||
      b.report_payment_status === "REFUNDED"
        ? b.report_razorpay_payment_id
        : null,
    capturedPaise: b.final_amount_paise ?? b.test_total_paise ?? 0,
  };
}
