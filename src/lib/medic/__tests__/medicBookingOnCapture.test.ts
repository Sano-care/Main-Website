// Aarogya create-on-capture — the webhook-driven booking write.
//  - reconstructs the full booking + booking_items from the cart intent
//  - fires BOTH confirmations (patient + ops lead alert) ONLY on a new booking
//  - idempotent replay does not double-notify
//  - no intent → LOUD alert, no booking
//  - amount drift → flagged + alerted, still books (money is in, §8)

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const persistBookingIdempotent = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const alertOnPostCaptureFailure = vi.fn<(...a: unknown[]) => Promise<unknown>>(
  async () => undefined,
);
vi.mock("@/lib/booking/paymentSafetyNet", () => ({
  persistBookingIdempotent: (...a: unknown[]) => persistBookingIdempotent(...a),
  alertOnPostCaptureFailure: (...a: unknown[]) => alertOnPostCaptureFailure(...a),
}));
vi.mock("@/lib/whatsapp/opsAlert", () => ({
  sendOpsAlert: vi.fn(async () => ({ sent: true, attempts: 1 })),
  OPS_ALERT_TARGET_DIGITS: "919760059900",
}));
vi.mock("@/lib/aarogya/meta", () => ({
  sendBookingConfirmed: vi.fn(async () => ({ delivered: true })),
}));
vi.mock("@/lib/booking/meta", () => ({
  sendAarogyaLeadAlert: vi.fn(async () => ({ delivered: true })),
}));

import { computeCartQuote, type ProcedureRow } from "@/lib/medic/cartPricing";
import { createMedicBookingFromCapture } from "@/lib/medic/medicBookingOnCapture";

const DRIP: ProcedureRow = {
  code: "iv_drip",
  name: "IV drip",
  tier: "standard",
  is_base_included: false,
  absolute_price_paise: 39_900,
  delta_paise: 0,
  price_type: "per_drip_hourly",
  hourly_addon_paise: 15_000,
};

const QUOTE = computeCartQuote([{ code: "iv_drip", qty: 1, hours: 3 }], [DRIP]);
// prepay 59800 (base 199 + drip 399), at-visit 300.

function makeIntent(over: Record<string, unknown> = {}) {
  return {
    cart_ref: "cart-1",
    conversation_id: "conv-1",
    customer_id: "cust-1",
    phone: "+919812345678",
    items: [{ code: "iv_drip", qty: 1, hours: 3 }],
    payment_mode: "full",
    charge_paise: QUOTE.prepay_paise, // 59800
    quote_snapshot: QUOTE,
    flow: "aarogya_medic_cart",
    razorpay_payment_link_id: "plink_1",
    razorpay_order_id: null,
    status: "pending",
    ...over,
  };
}

function makeSupabase(intent: unknown) {
  const bookingItemsInserted: unknown[] = [];
  const client = {
    from(table: string) {
      if (table === "medic_cart_intents") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: intent, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === "customers") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: "Test Patient" }, error: null }) }) }),
        };
      }
      if (table === "booking_items") {
        return {
          select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }),
          insert: (rows: unknown[]) => {
            bookingItemsInserted.push(...rows);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client: client as never, bookingItemsInserted };
}

const baseArgs = {
  cartRef: "cart-1",
  orderId: "order_abc",
  paymentId: "pay_xyz",
  amountPaise: QUOTE.prepay_paise, // captured == locked
  contact: "+919812345678",
};

let sendBookingConfirmedFn: ReturnType<typeof vi.fn>;
let sendAarogyaLeadAlertFn: ReturnType<typeof vi.fn>;
let sendOpsAlertFn: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  sendBookingConfirmedFn = vi.fn(async () => ({ delivered: true }));
  sendAarogyaLeadAlertFn = vi.fn(async () => ({ delivered: true }));
  sendOpsAlertFn = vi.fn(async () => ({ sent: true, attempts: 1 }));
});

describe("createMedicBookingFromCapture", () => {
  it("new booking → persists, snapshots booking_items, fires BOTH confirmations", async () => {
    persistBookingIdempotent.mockResolvedValue({
      ok: true, bookingId: "bk-1", bookingCode: "SAN-B-1", wasNewlyInserted: true,
    });
    const { client, bookingItemsInserted } = makeSupabase(makeIntent());

    const res = await createMedicBookingFromCapture(baseArgs, {
      supabase: client,
      sendBookingConfirmedFn: sendBookingConfirmedFn as never,
      sendAarogyaLeadAlertFn: sendAarogyaLeadAlertFn as never,
      sendOpsAlertFn: sendOpsAlertFn as never,
    });

    expect(res.action).toBe("created");
    expect(res.bookingId).toBe("bk-1");

    // Booking payload: server-authoritative, medic-at-home, CAPTURED.
    const payload = persistBookingIdempotent.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.service_category).toBe("medic-at-home");
    expect(payload.payment_status).toBe("CAPTURED");
    expect(payload.razorpay_order_id).toBe("order_abc");
    expect(payload.booking_fee_paid_paise).toBe(QUOTE.prepay_paise);
    expect(payload.patient_name).toBe("Test Patient");

    // booking_items snapshot = every quote line.
    expect(bookingItemsInserted).toHaveLength(QUOTE.line_items.length);

    // BOTH confirmations fired (§5.5 — the relay that used to silently fail).
    expect(sendBookingConfirmedFn).toHaveBeenCalledTimes(1);
    expect(sendAarogyaLeadAlertFn).toHaveBeenCalledTimes(1);
    expect(sendBookingConfirmedFn.mock.calls[0][0].serviceSlug).toBe("medic-at-home");
  });

  it("idempotent replay (wasNewlyInserted=false) does NOT double-notify", async () => {
    persistBookingIdempotent.mockResolvedValue({
      ok: true, bookingId: "bk-1", bookingCode: "SAN-B-1", wasNewlyInserted: false,
    });
    const { client } = makeSupabase(makeIntent());
    const res = await createMedicBookingFromCapture(baseArgs, {
      supabase: client,
      sendBookingConfirmedFn: sendBookingConfirmedFn as never,
      sendAarogyaLeadAlertFn: sendAarogyaLeadAlertFn as never,
      sendOpsAlertFn: sendOpsAlertFn as never,
    });
    expect(res.action).toBe("already_present");
    expect(sendBookingConfirmedFn).not.toHaveBeenCalled();
    expect(sendAarogyaLeadAlertFn).not.toHaveBeenCalled();
  });

  it("no intent for cart_ref → LOUD alert, no booking write", async () => {
    const { client } = makeSupabase(null);
    const res = await createMedicBookingFromCapture(baseArgs, {
      supabase: client,
      sendOpsAlertFn: sendOpsAlertFn as never,
    });
    expect(res.action).toBe("no_intent");
    expect(alertOnPostCaptureFailure).toHaveBeenCalledTimes(1);
    expect(persistBookingIdempotent).not.toHaveBeenCalled();
  });

  it("amount drift (captured ≠ locked) is flagged + alerted, still books", async () => {
    persistBookingIdempotent.mockResolvedValue({
      ok: true, bookingId: "bk-2", bookingCode: "SAN-B-2", wasNewlyInserted: true,
    });
    const { client } = makeSupabase(makeIntent());
    const res = await createMedicBookingFromCapture(
      { ...baseArgs, amountPaise: 100 }, // tampered/short capture
      {
        supabase: client,
        sendBookingConfirmedFn: sendBookingConfirmedFn as never,
        sendAarogyaLeadAlertFn: sendAarogyaLeadAlertFn as never,
        sendOpsAlertFn: sendOpsAlertFn as never,
      },
    );
    expect(res.action).toBe("created"); // money is in → never dropped
    expect(sendOpsAlertFn).toHaveBeenCalled(); // drift alert fired
    const payload = persistBookingIdempotent.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.ops_notes).toContain("AMOUNT DRIFT");
  });
});
