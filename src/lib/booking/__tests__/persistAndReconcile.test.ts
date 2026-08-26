// P0 revenue-leak fix — tests for the two new safety-net pieces:
//   - persistBookingIdempotent: the atomic + idempotent + LOUD "capture →
//     booking" write used by /api/razorpay/verify.
//   - reconcileRazorpayOrphans: the active backstop that polls Razorpay for
//     captured payments and ensures each has a booking.

import { describe, expect, it, vi } from "vitest";

// Same module-eval break as paymentSafetyNet.test.ts — opsAlert pulls in
// supabase-server which createClient()s at import time.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/whatsapp/opsAlert", () => ({
  sendOpsAlert: vi.fn(async () => ({ sent: true, attempts: 1 })),
  OPS_ALERT_TARGET_DIGITS: "919760059900",
}));

import {
  persistBookingIdempotent,
  reconcileRazorpayOrphans,
  alertOnPostCaptureFailure,
  WEBHOOK_RECONCILE_MARKER,
  type RazorpayPaymentLite,
} from "@/lib/booking/paymentSafetyNet";

type Row = Record<string, unknown>;

// In-memory `bookings` mock (mirrors paymentSafetyNet.test.ts): honours
// select/insert/update + eq/neq/gte/lt/lte/like + single/maybeSingle. Insert of
// an order_id that already exists returns 23505 (partial unique index).
function makeDb(seed: Row[] = []) {
  const rows = seed.map((r) => ({ ...r }));
  let idc = 1000;

  const from = (table: string) => {
    if (table !== "bookings" && table !== "customers")
      throw new Error(`unexpected table ${table}`);
    const filters: [string, string, unknown][] = [];
    let op: "select" | "insert" | "update" | null = null;
    let payload: Row = {};
    let insertRow: Row | null = null;

    const match = () =>
      rows.filter((r) =>
        filters.every(([m, c, v]) => {
          const val = r[c];
          switch (m) {
            case "eq":
              return val === v;
            case "neq":
              return val !== v;
            default:
              return true;
          }
        }),
      );

    const chain: Record<string, unknown> = {
      select: () => {
        if (!op) op = "select";
        return chain;
      },
      insert: (r: Row) => {
        op = "insert";
        insertRow = r;
        return chain;
      },
      update: (p: Row) => {
        op = "update";
        payload = p;
        return chain;
      },
      eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), chain),
      neq: (c: string, v: unknown) => (filters.push(["neq", c, v]), chain),
      is: (c: string, v: unknown) => (filters.push(["eq", c, v]), chain),
      maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
      single: async () => {
        if (op === "insert" && insertRow) {
          const orderId = insertRow.razorpay_order_id;
          if (
            orderId != null &&
            rows.some((r) => r.razorpay_order_id === orderId)
          ) {
            return { data: null, error: { code: "23505" } };
          }
          const created = {
            id: `bk-${idc++}`,
            booking_code: `SAN-B-${idc}`,
            ...insertRow,
          };
          rows.push(created);
          return {
            data: { id: created.id, booking_code: created.booking_code },
            error: null,
          };
        }
        if (op === "update") {
          const hit = match();
          hit.forEach((r) => Object.assign(r, payload));
          const r0 = hit[0];
          return {
            data: r0 ? { id: r0.id, booking_code: r0.booking_code } : null,
            error: null,
          };
        }
        return { data: match()[0] ?? null, error: null };
      },
      then: (resolve: (v: unknown) => void) => {
        if (op === "update") {
          match().forEach((r) => Object.assign(r, payload));
          return resolve({ data: null, error: null });
        }
        return resolve({ data: match(), error: null });
      },
    };
    return chain;
  };

  return { client: { from } as never, rows };
}

const okAlert = () => vi.fn(async () => ({ sent: true, attempts: 1 }));
const NOW = new Date("2026-08-18T12:00:00Z");

const basePayload = (over: Row = {}): Row => ({
  patient_name: "Asha",
  phone: "+919812345678",
  service_category: "medic-at-home",
  manual_address: "12 MG Road",
  status: "CONFIRMED",
  razorpay_order_id: "order_ABC",
  razorpay_payment_id: "pay_XYZ",
  payment_status: "CAPTURED",
  booking_fee_paid_paise: 10_000,
  ...over,
});

describe("persistBookingIdempotent", () => {
  it("fresh order → inserts, ok, wasNewlyInserted=true, no alert", async () => {
    const { client, rows } = makeDb([]);
    const sendOpsAlertFn = okAlert();
    const r = await persistBookingIdempotent(basePayload(), "order_ABC", {
      supabase: client,
      sendOpsAlertFn,
    });
    expect(r.ok).toBe(true);
    expect(r.wasNewlyInserted).toBe(true);
    expect(r.bookingId).toBeTruthy();
    expect(sendOpsAlertFn).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0].service_category).toBe("medic-at-home");
  });

  it("duplicate order (23505) → upgrades in place, wasNewlyInserted=false, no alert", async () => {
    const { client, rows } = makeDb([
      {
        id: "bk-1",
        booking_code: "SAN-B-1",
        razorpay_order_id: "order_ABC",
        patient_name: "[Webhook — details pending]",
        payment_status: "CAPTURED",
      },
    ]);
    const sendOpsAlertFn = okAlert();
    const r = await persistBookingIdempotent(
      basePayload({ patient_name: "Asha (real)" }),
      "order_ABC",
      { supabase: client, sendOpsAlertFn },
    );
    expect(r.ok).toBe(true);
    expect(r.wasNewlyInserted).toBe(false);
    expect(sendOpsAlertFn).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1); // no duplicate
    expect(rows[0].patient_name).toBe("Asha (real)"); // upgraded in place
  });

  it("genuine DB error (not 23505) → LOUD ops alert + ok=false", async () => {
    const failClient = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: { code: "23514", message: "check constraint violation" },
            }),
          }),
        }),
      }),
    } as never;
    const sendOpsAlertFn = okAlert();
    const r = await persistBookingIdempotent(basePayload(), "order_ABC", {
      supabase: failClient,
      sendOpsAlertFn,
    });
    expect(r.ok).toBe(false);
    expect(sendOpsAlertFn).toHaveBeenCalledTimes(1);
    const calls = sendOpsAlertFn.mock.calls as unknown as Array<
      [{ context: string }]
    >;
    expect(calls[0][0].context).toContain("pay_XYZ");
    expect(calls[0][0].context).toContain("NO booking");
  });
});

describe("reconcileRazorpayOrphans", () => {
  const cap = (over: Partial<RazorpayPaymentLite> = {}): RazorpayPaymentLite => ({
    id: "pay_1",
    order_id: "order_1",
    status: "captured",
    amount: 10_000,
    contact: "+919812345678",
    email: null,
    ...over,
  });

  it("orphan captured payment → stub ensured + alerted; already-booked → left alone", async () => {
    const { client, rows } = makeDb([
      { id: "bk-existing", razorpay_order_id: "order_present", payment_status: "CAPTURED" },
    ]);
    const sendOpsAlertFn = okAlert();
    const r = await reconcileRazorpayOrphans({
      supabase: client,
      listPayments: async () => [
        cap({ id: "pay_present", order_id: "order_present" }), // already booked
        cap({ id: "pay_orphan", order_id: "order_orphan" }), // orphan
      ],
      fetchOrderNotes: async () => ({ t85_slug: "medic-at-home" }),
      sendOpsAlertFn,
      now: NOW,
    });

    expect(r.scanned).toBe(2);
    expect(r.orphansEnsured).toBe(1);
    expect(r.alreadyPresent).toBe(1);
    expect(sendOpsAlertFn).toHaveBeenCalledTimes(1); // only the orphan
    const stub = rows.find((x) => x.razorpay_order_id === "order_orphan");
    expect(stub).toBeTruthy();
    expect(String(stub!.ops_notes)).toContain(WEBHOOK_RECONCILE_MARKER);
    expect(stub!.service_category).toBe("medic-at-home");
  });

  it("skips non-captured payments and payments with no order_id", async () => {
    const { client } = makeDb([]);
    const sendOpsAlertFn = okAlert();
    const r = await reconcileRazorpayOrphans({
      supabase: client,
      listPayments: async () => [
        cap({ id: "pay_auth", status: "authorized" }),
        cap({ id: "pay_failed", status: "failed" }),
        cap({ id: "pay_noorder", order_id: null }),
      ],
      fetchOrderNotes: async () => ({}),
      sendOpsAlertFn,
      now: NOW,
    });
    expect(r.scanned).toBe(0);
    expect(r.orphansEnsured).toBe(0);
    expect(sendOpsAlertFn).not.toHaveBeenCalled();
  });

  it("empty window → scanned 0, no alerts", async () => {
    const { client } = makeDb([]);
    const sendOpsAlertFn = okAlert();
    const r = await reconcileRazorpayOrphans({
      supabase: client,
      listPayments: async () => [],
      fetchOrderNotes: async () => ({}),
      sendOpsAlertFn,
      now: NOW,
    });
    expect(r.ran).toBe(true);
    expect(r.scanned).toBe(0);
    expect(sendOpsAlertFn).not.toHaveBeenCalled();
  });

  it("skips the report-fee lane (lab_report_payment) — no phantom stub/alert", async () => {
    const { client, rows } = makeDb([]);
    const sendOpsAlertFn = okAlert();
    const r = await reconcileRazorpayOrphans({
      supabase: client,
      listPayments: async () => [
        cap({ id: "pay_report", order_id: "order_report", notes: { flow: "lab_report_payment" } }),
        cap({ id: "pay_booking", order_id: "order_booking" }), // real booking orphan
      ],
      fetchOrderNotes: async () => ({ flow: "pb5_medic_cart" }),
      sendOpsAlertFn,
      now: NOW,
    });
    expect(r.skippedReportLane).toBe(1);
    expect(r.scanned).toBe(1); // only the booking payment
    expect(r.orphansEnsured).toBe(1);
    expect(sendOpsAlertFn).toHaveBeenCalledTimes(1);
    expect(rows.find((x) => x.razorpay_order_id === "order_report")).toBeUndefined();
  });

  it("pb5_medic_cart orphan (no t85_slug) → stub resolves service via the flow map", async () => {
    const { client, rows } = makeDb([]);
    const sendOpsAlertFn = okAlert();
    const r = await reconcileRazorpayOrphans({
      supabase: client,
      listPayments: async () => [cap({ id: "pay_medic", order_id: "order_medic" })],
      // pb5_medic_cart stashes flow + customer_id + cart_hash but NO t85_slug.
      fetchOrderNotes: async () => ({ flow: "pb5_medic_cart", customer_id: "c1" }),
      sendOpsAlertFn,
      now: NOW,
    });
    expect(r.orphansEnsured).toBe(1);
    const stub = rows.find((x) => x.razorpay_order_id === "order_medic");
    expect(stub).toBeTruthy();
    expect(stub!.service_category).toBe("medic-at-home"); // NOT "unknown"
  });
});

describe("alertOnPostCaptureFailure", () => {
  it("fires a loud ops alert carrying order/payment/amount/contact/reason", async () => {
    const sendOpsAlertFn = okAlert();
    await alertOnPostCaptureFailure(
      {
        orderId: "order_ABC",
        paymentId: "pay_XYZ",
        amountPaise: 20_000,
        contact: "+919812345678",
        serviceDisplay: "Teleconsultation",
        reason: "Razorpay order fetch failed — integrity uncheckable",
      },
      { sendOpsAlertFn },
    );
    expect(sendOpsAlertFn).toHaveBeenCalledTimes(1);
    const arg = (sendOpsAlertFn.mock.calls as unknown as Array<
      [{ context: string; serviceDisplay: string; patientMobile: string }]
    >)[0][0];
    expect(arg.context).toContain("order_ABC");
    expect(arg.context).toContain("pay_XYZ");
    expect(arg.context).toContain("₹200");
    expect(arg.context).toContain("order fetch failed");
    expect(arg.serviceDisplay).toBe("Teleconsultation");
    expect(arg.patientMobile).toBe("+919812345678");
  });

  it("never throws even when the sender rejects (belt-and-braces)", async () => {
    const throwingAlert = vi.fn(async () => {
      throw new Error("BSP down");
    });
    await expect(
      alertOnPostCaptureFailure(
        { orderId: "o", paymentId: "p", reason: "x" },
        { sendOpsAlertFn: throwingAlert },
      ),
    ).resolves.toBeUndefined();
    expect(throwingAlert).toHaveBeenCalledTimes(1);
  });
});
