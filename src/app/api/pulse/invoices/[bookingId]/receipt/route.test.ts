import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  customer: { id: "cust-1", full_name: "Asha Patel" } as
    | { id: string; full_name: string }
    | null,
  eqs: {} as Record<string, unknown>,
  neqs: [] as Array<[string, unknown]>,
  row: null as Record<string, unknown> | null,
  renderArgs: null as Record<string, unknown> | null,
}));

vi.mock("@/app/pulse/_lib/requireCustomer", () => ({
  requirePulseCustomer: vi.fn(async () =>
    h.customer
      ? { customer: h.customer }
      : { response: new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }) },
  ),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => {
          h.eqs[c] = v;
          return b;
        },
        neq: (c: string, v: unknown) => {
          h.neqs.push([c, v]);
          return b;
        },
        order: () => b,
        limit: () => Promise.resolve({ data: h.row ? [h.row] : [], error: null }),
      };
      return b;
    },
  },
}));

// Mock the renderer — we assert the data it's handed + the response envelope,
// not the @react-pdf bytes (that stack is exercised by the Rx pipeline).
vi.mock("@/lib/receipt/pdf/renderReceiptPdf", () => ({
  renderReceiptPdf: vi.fn(async (data: Record<string, unknown>) => {
    h.renderArgs = data;
    return Buffer.from("%PDF-1.4 fake-receipt");
  }),
}));

import { GET } from "./route";

const VALID = "22222222-2222-4222-8222-222222222222";
const ctx = (bookingId: string) => ({ params: Promise.resolve({ bookingId }) });
const req = () =>
  new NextRequest("http://t/api/pulse/invoices/x/receipt", { method: "GET" });

function capturedRow(over: Record<string, unknown> = {}) {
  return {
    booking_code: "SAN-B-00042",
    customer_name: "Asha Patel",
    service_category: "lab-tests",
    amount_paise: 120050,
    status: "CAPTURED",
    razorpay_payment_id: "pay_ABCD1234WXYZ",
    captured_at: "2026-06-10T09:00:00Z",
    created_at: "2026-06-10T09:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  h.customer = { id: "cust-1", full_name: "Asha Patel" };
  h.eqs = {};
  h.neqs = [];
  h.row = capturedRow();
  h.renderArgs = null;
});

describe("GET /api/pulse/invoices/:bookingId/receipt", () => {
  it("own captured payment → 200 application/pdf, attachment filename, scoped to session customer", async () => {
    const res = await GET(req(), ctx(VALID));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="Sanocare-Receipt-SAN-B-00042.pdf"',
    );
    // Hard IDOR scope: looked up by BOTH booking_id and the SESSION customer_id.
    expect(h.eqs).toMatchObject({ booking_id: VALID, customer_id: "cust-1" });
    // Receipts only — NOT_DUE excluded at the DB.
    expect(h.neqs).toContainEqual(["status", "NOT_DUE"]);
    // The renderer got the mapped receipt data.
    expect(h.renderArgs).toMatchObject({
      receipt_no: "SAN-B-00042",
      status: "CAPTURED",
      amount_display: "₹1,200.50",
      bill_to: "Asha Patel",
      payment_ref: "pay_ABCD1234WXYZ",
    });
  });

  it("IDOR: a booking that isn't the session customer's → 404 (never another customer's receipt)", async () => {
    // Simulate the customer_id scope excluding the row (DB returns nothing).
    h.row = null;
    const res = await GET(req(), ctx(VALID));
    expect(res.status).toBe(404);
    // The scope was still applied to the query — customer_id came from the session.
    expect(h.eqs).toMatchObject({ booking_id: VALID, customer_id: "cust-1" });
  });

  it("no captured payment (NOT_DUE-only booking) → 404, renderer never called", async () => {
    h.row = null;
    const res = await GET(req(), ctx(VALID));
    expect(res.status).toBe(404);
    expect(h.renderArgs).toBeNull();
  });

  it("REFUNDED payment → receipt labelled Refunded", async () => {
    h.row = capturedRow({ status: "REFUNDED" });
    const res = await GET(req(), ctx(VALID));
    expect(res.status).toBe(200);
    expect(h.renderArgs).toMatchObject({ status: "REFUNDED" });
  });

  it("unauthenticated → 401, no DB query", async () => {
    h.customer = null;
    const res = await GET(req(), ctx(VALID));
    expect(res.status).toBe(401);
    expect(h.eqs).toEqual({});
  });

  it("malformed booking id → 400, no DB query", async () => {
    const res = await GET(req(), ctx("not-a-uuid"));
    expect(res.status).toBe(400);
    expect(h.eqs).toEqual({});
  });
});
