// Razorpay revenue safety net — the webhook backstop that stops
// captured-payment-without-booking leaks.
//
// Covers:
//   - orphan capture (no booking) → reconciliation stub created + ops alerted
//   - re-sent event (Razorpay retry) → idempotent no-op, no duplicate, no alert
//   - existing-but-uncaptured booking → flipped to CAPTURED
//   - unique-index race (23505) → swallowed as success, no alert
//   - monitor: stuck stub >15min alerts; fresh stub doesn't; pipeline-silence alerts

import { describe, expect, it, vi } from "vitest";

// Break the opsAlert → audit → supabase-server module-eval chain (which
// createClient()s at import time and needs env). We inject sendOpsAlertFn into
// every call, so the real sender is never exercised.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/whatsapp/opsAlert", () => ({
  sendOpsAlert: vi.fn(async () => ({ sent: true, attempts: 1 })),
  OPS_ALERT_TARGET_DIGITS: "919760059900",
}));

import {
  ensureBookingForCapturedOrder,
  runPaymentLeakMonitor,
  WEBHOOK_RECONCILE_MARKER,
} from "@/lib/booking/paymentSafetyNet";

type Row = Record<string, unknown>;

/**
 * In-memory `bookings` mock honouring the chained filters + terminals the
 * safety net uses: select/insert/update, eq/neq/gte/lt/lte/like,
 * maybeSingle/single, count-head, and a thenable tail for update/select.
 * `throwUnique` forces the next insert to fail with 23505 (simulates the
 * partial unique index tripping on a race).
 */
function makeDb(seed: Row[] = [], opts: { throwUnique?: boolean } = {}) {
  const rows = seed.map((r) => ({ ...r }));
  let idc = 1000;

  const from = (table: string) => {
    if (table !== "bookings") throw new Error(`unexpected table ${table}`);
    const filters: [string, string, unknown][] = [];
    let op: "select" | "insert" | "update" | null = null;
    let payload: Row = {};
    let insertRow: Row | null = null;
    let selCount = false;
    let selHead = false;

    const match = () =>
      rows.filter((r) =>
        filters.every(([m, c, v]) => {
          const val = r[c];
          switch (m) {
            case "eq":
              return val === v;
            case "neq":
              return val !== v;
            case "gte":
              return val != null && String(val) >= String(v);
            case "lt":
              return val != null && String(val) < String(v);
            case "lte":
              return val != null && String(val) <= String(v);
            case "like":
              return (
                typeof val === "string" &&
                val.startsWith(String(v).replace(/%$/, ""))
              );
            default:
              return true;
          }
        }),
      );

    const chain: Record<string, unknown> = {
      select: (_c?: string, o?: { count?: string; head?: boolean }) => {
        if (o?.count) selCount = true;
        if (o?.head) selHead = true;
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
      gte: (c: string, v: unknown) => (filters.push(["gte", c, v]), chain),
      lt: (c: string, v: unknown) => (filters.push(["lt", c, v]), chain),
      lte: (c: string, v: unknown) => (filters.push(["lte", c, v]), chain),
      like: (c: string, v: unknown) => (filters.push(["like", c, v]), chain),
      maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
      single: async () => {
        if (op === "insert" && insertRow) {
          const orderId = insertRow.razorpay_order_id;
          if (
            opts.throwUnique ||
            (orderId != null &&
              rows.some((r) => r.razorpay_order_id === orderId))
          ) {
            return { data: null, error: { code: "23505" } };
          }
          const created = { id: `bk-${idc++}`, ...insertRow };
          rows.push(created);
          return { data: { id: created.id }, error: null };
        }
        return { data: match()[0] ?? null, error: null };
      },
      then: (resolve: (v: unknown) => void) => {
        if (op === "update") {
          match().forEach((r) => Object.assign(r, payload));
          return resolve({ data: null, error: null });
        }
        if (selCount && selHead) {
          return resolve({ count: match().length, error: null, data: null });
        }
        return resolve({ data: match(), error: null });
      },
    };
    return chain;
  };

  return { client: { from } as never, rows };
}

const NOW = new Date("2026-07-20T12:00:00Z");
const okAlert = () => vi.fn(async () => ({ sent: true, attempts: 1 }));

const captureArgs = (over: Partial<Row> = {}) => ({
  orderId: "order_ABC",
  paymentId: "pay_XYZ",
  amountPaise: 25_000,
  contact: "+919812345678",
  email: "p@example.com",
  ...over,
});

describe("ensureBookingForCapturedOrder", () => {
  it("orphan capture (no booking) → reconciliation stub + ops alert", async () => {
    const { client, rows } = makeDb([]);
    const sendOpsAlertFn = okAlert();
    const r = await ensureBookingForCapturedOrder(captureArgs(), {
      supabase: client,
      fetchOrderNotes: async () => ({ t85_slug: "home-visit" }),
      sendOpsAlertFn,
      now: NOW,
    });

    expect(r.action).toBe("reconciliation_created");
    expect(r.opsAlerted).toBe(true);
    expect(sendOpsAlertFn).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    const stub = rows[0];
    expect(stub.razorpay_order_id).toBe("order_ABC");
    expect(stub.payment_status).toBe("CAPTURED");
    expect(stub.service_category).toBe("home-visit"); // recovered from order notes
    expect(stub.amount).toBe(250); // 25000 paise → ₹250
    expect(stub.status).toBe("PENDING");
    expect(String(stub.ops_notes)).toContain(WEBHOOK_RECONCILE_MARKER);
    expect(String(stub.patient_name)).toContain("pending");
  });

  it("re-sent event (booking now exists + CAPTURED) → idempotent no-op, no alert, no dup", async () => {
    const { client, rows } = makeDb([
      { id: "bk-1", razorpay_order_id: "order_ABC", payment_status: "CAPTURED" },
    ]);
    const sendOpsAlertFn = okAlert();
    const r = await ensureBookingForCapturedOrder(captureArgs(), {
      supabase: client,
      fetchOrderNotes: async () => ({}),
      sendOpsAlertFn,
      now: NOW,
    });

    expect(r.action).toBe("already_captured");
    expect(sendOpsAlertFn).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1); // no duplicate
  });

  it("booking exists but not yet CAPTURED (verify won the race) → flipped to CAPTURED", async () => {
    const { client, rows } = makeDb([
      { id: "bk-1", razorpay_order_id: "order_ABC", payment_status: "PENDING" },
    ]);
    const sendOpsAlertFn = okAlert();
    const r = await ensureBookingForCapturedOrder(captureArgs(), {
      supabase: client,
      fetchOrderNotes: async () => ({}),
      sendOpsAlertFn,
      now: NOW,
    });

    expect(r.action).toBe("marked_captured");
    expect(rows[0].payment_status).toBe("CAPTURED");
    expect(sendOpsAlertFn).not.toHaveBeenCalled();
  });

  it("service falls back to 'unknown' when order notes are empty", async () => {
    const { client, rows } = makeDb([]);
    const r = await ensureBookingForCapturedOrder(captureArgs(), {
      supabase: client,
      fetchOrderNotes: async () => ({}),
      sendOpsAlertFn: okAlert(),
      now: NOW,
    });
    expect(r.action).toBe("reconciliation_created");
    expect(rows[0].service_category).toBe("unknown");
  });

  it("unique-index race (23505 on insert) → swallowed as success, no alert", async () => {
    const { client, rows } = makeDb([], { throwUnique: true });
    const sendOpsAlertFn = okAlert();
    const r = await ensureBookingForCapturedOrder(captureArgs(), {
      supabase: client,
      fetchOrderNotes: async () => ({ t85_slug: "home-visit" }),
      sendOpsAlertFn,
      now: NOW,
    });

    expect(r.action).toBe("race_lost");
    expect(sendOpsAlertFn).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });
});

describe("runPaymentLeakMonitor", () => {
  const stub = (over: Row = {}): Row => ({
    id: `bk-${Math.random().toString(36).slice(2, 7)}`,
    status: "PENDING",
    ops_notes: `${WEBHOOK_RECONCILE_MARKER} orphan`,
    razorpay_order_id: "order_1",
    amount: 250,
    payment_status: "CAPTURED",
    ...over,
  });

  it("stuck stub older than 15 min → alert", async () => {
    const { client } = makeDb([
      stub({ payment_captured_at: "2026-07-20T11:00:00Z" }), // 1h ago
    ]);
    const sendOpsAlertFn = okAlert();
    const r = await runPaymentLeakMonitor({
      supabase: client,
      sendOpsAlertFn,
      now: NOW,
    });
    expect(r.stuckReconcileCount).toBe(1);
    expect(sendOpsAlertFn).toHaveBeenCalledTimes(1);
  });

  it("fresh stub (<15 min old) → no stuck alert", async () => {
    const { client } = makeDb([
      stub({ payment_captured_at: "2026-07-20T11:55:00Z" }), // 5 min ago
    ]);
    const sendOpsAlertFn = okAlert();
    const r = await runPaymentLeakMonitor({
      supabase: client,
      sendOpsAlertFn,
      now: NOW,
    });
    expect(r.stuckReconcileCount).toBe(0);
    expect(sendOpsAlertFn).not.toHaveBeenCalled();
  });

  it("pipeline silent (0 captured in 24h, but active in prior 24h) → alert", async () => {
    const { client } = makeDb([
      // A real booking from ~36h ago — pipeline WAS active, now silent.
      {
        id: "old",
        status: "CONFIRMED",
        ops_notes: null,
        payment_status: "CAPTURED",
        payment_captured_at: "2026-07-19T00:00:00Z",
      },
    ]);
    const sendOpsAlertFn = okAlert();
    const r = await runPaymentLeakMonitor({
      supabase: client,
      sendOpsAlertFn,
      now: NOW,
    });
    expect(r.pipelineSilent).toBe(true);
    expect(sendOpsAlertFn).toHaveBeenCalledTimes(1);
  });

  it("healthy pipeline (recent captured booking) → no silence alert", async () => {
    const { client } = makeDb([
      {
        id: "recent",
        status: "CONFIRMED",
        ops_notes: null,
        payment_status: "CAPTURED",
        payment_captured_at: "2026-07-20T09:00:00Z", // 3h ago
      },
    ]);
    const sendOpsAlertFn = okAlert();
    const r = await runPaymentLeakMonitor({
      supabase: client,
      sendOpsAlertFn,
      now: NOW,
    });
    expect(r.pipelineSilent).toBe(false);
    expect(sendOpsAlertFn).not.toHaveBeenCalled();
  });
});
