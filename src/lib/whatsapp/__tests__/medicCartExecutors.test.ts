// Aarogya Medic-at-Home cart tools — money-path tests.
//  - pricing engine correctness vs catalog (drip stacking + `from` floor)
//  - Rx-required routing: rx='yes' quotes but NEVER self-books (routes to ops)
//  - self-serve: server-priced payment link, amount price-locked from the
//    catalog (never a client/model value), and NO booking is created here
//  - receipt-only: the only booking creator is the webhook, not these tools

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/razorpay", () => ({ getRazorpayClient: vi.fn() }));
vi.mock("@/lib/whatsapp/opsAlert", () => ({
  sendOpsAlert: vi.fn(async () => ({ sent: true, attempts: 1 })),
  OPS_ALERT_TARGET_DIGITS: "919760059900",
}));
vi.mock("@/lib/whatsapp/log", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  maskPhone: (p: string) => p,
}));

import {
  computeCartQuote,
  type ProcedureRow,
} from "@/lib/medic/cartPricing";
import type { LoadedCartQuote } from "@/lib/medic/serverCart";
import {
  executeQuoteMedicCart,
  executeStartMedicBooking,
  type CreatedPaymentLink,
} from "@/lib/whatsapp/medicCartExecutors";
import type { Identity } from "@/lib/whatsapp/identity";

type CreateLinkFn = (args: {
  amountPaise: number;
  description: string;
  contact: string;
  name: string | null;
  notes: Record<string, string>;
}) => Promise<CreatedPaymentLink>;

const patient = { role: "customer", subRole: "known", customerId: "cust-1" } as unknown as Identity;

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
const FROM_ITEM: ProcedureRow = {
  code: "catheter",
  name: "Catheter care",
  tier: "advanced",
  is_base_included: false,
  absolute_price_paise: 0,
  delta_paise: 60_000,
  price_type: "from",
};

// ── pricing engine correctness (the numbers Aarogya must quote) ──
describe("computeCartQuote — canonical model", () => {
  it("drip stacks on the ₹199 base: 1 drip, 3h → prepay 598, at-visit 300", () => {
    const q = computeCartQuote([{ code: "iv_drip", qty: 1, hours: 3 }], [DRIP]);
    // base ₹199 + drip ₹399 (incl 1st hour) = ₹598 prepaid; 2 extra hours × ₹150 = ₹300 at visit.
    expect(q.prepay_paise).toBe(19_900 + 39_900);
    expect(q.at_visit_paise).toBe(2 * 15_000);
    expect(q.total_paise).toBe(q.prepay_paise + q.at_visit_paise);
    const drip = q.line_items.find((l) => l.code === "iv_drip")!;
    expect(drip.is_variable).toBe(true);
  });

  it("`from` items prepay the floor and flag variable", () => {
    const q = computeCartQuote([{ code: "catheter", qty: 1 }], [FROM_ITEM]);
    expect(q.prepay_paise).toBe(19_900 + 60_000); // base + floor
    expect(q.at_visit_paise).toBe(0);
    const line = q.line_items.find((l) => l.code === "catheter")!;
    expect(line.is_variable).toBe(true);
    expect(line.line_total_paise).toBe(60_000);
  });
});

// A LoadedCartQuote fixture driven by the real engine.
function loaded(
  items: { code: string; qty: number; hours?: number; units?: number }[],
  rows: ProcedureRow[],
  rx: { rxYes?: string[]; rxCaseByCase?: string[] } = {},
): LoadedCartQuote {
  return {
    quote: computeCartQuote(items, rows),
    rows: rows.map((r) => ({ ...r, rx_required: null })),
    rxYes: rx.rxYes ?? [],
    rxCaseByCase: rx.rxCaseByCase ?? [],
  };
}

/** Minimal chainable supabase for createCartIntent + attachLinkToIntent + customers. */
function makeSupabase() {
  const calls = { inserted: [] as unknown[], updated: [] as unknown[] };
  const client = {
    from(table: string) {
      const node = {
        _table: table,
        _payload: null as unknown,
        select() {
          return node;
        },
        eq() {
          return node;
        },
        insert(p: unknown) {
          calls.inserted.push({ table, p });
          node._payload = p;
          return node;
        },
        update(p: unknown) {
          calls.updated.push({ table, p });
          return { eq: async () => ({ error: null }) };
        },
        maybeSingle: async () =>
          table === "customers"
            ? { data: { full_name: "Test Patient" }, error: null }
            : { data: null, error: null },
        single: async () =>
          table === "medic_cart_intents"
            ? { data: { cart_ref: "cart-ref-123" }, error: null }
            : { data: null, error: null },
      };
      return node;
    },
  };
  return { client: client as never, calls };
}

const ctx = {
  identity: patient,
  phone: "+919812345678",
  conversationId: "conv-1",
  customerId: "cust-1",
};

beforeEach(() => vi.clearAllMocks());

describe("executeQuoteMedicCart", () => {
  it("returns the exact pay-now amount + flags at-visit variable + Rx note", async () => {
    const { client } = makeSupabase();
    const reply = await executeQuoteMedicCart(
      { identity: patient, input: { items: [{ code: "iv_drip", qty: 1, hours: 3 }] } },
      { supabase: client, loadAndQuoteCartFn: async () => loaded([{ code: "iv_drip", qty: 1, hours: 3 }], [DRIP], { rxYes: ["iv_drip"] }) },
    );
    expect(reply).toContain("₹598"); // pay now
    expect(reply.toLowerCase()).toContain("at the visit");
    expect(reply.toLowerCase()).toContain("prescription"); // rxYes note
  });
});

describe("executeStartMedicBooking — Rx routing (§5.4)", () => {
  it("rx_required='yes' → routes to ops, sends NO payment link, creates NO booking", async () => {
    const { client, calls } = makeSupabase();
    const sendOpsAlertFn = vi.fn(async () => ({ sent: true, attempts: 1 }));
    const createPaymentLink = vi.fn<CreateLinkFn>(async () => ({ id: "plink", short_url: "https://x" }));
    const reply = await executeStartMedicBooking(
      { input: { items: [{ code: "iv_drip", qty: 1 }] } },
      ctx,
      {
        supabase: client,
        loadAndQuoteCartFn: async () => loaded([{ code: "iv_drip", qty: 1 }], [DRIP], { rxYes: ["iv_drip"] }),
        createPaymentLink,
        sendOpsAlertFn,
      },
    );
    expect(sendOpsAlertFn).toHaveBeenCalledTimes(1); // routed to ops
    expect(createPaymentLink).not.toHaveBeenCalled(); // NO self-book link
    expect(calls.inserted).toHaveLength(0); // no cart intent, no booking
    expect(reply.toLowerCase()).toContain("prescription");
    expect(reply.toLowerCase()).toContain("don't need to pay");
  });
});

describe("executeStartMedicBooking — self-serve (non-Rx)", () => {
  it("price-locks the link amount from the server quote (full mode) + creates an intent, NOT a booking", async () => {
    const { client, calls } = makeSupabase();
    const createPaymentLink = vi.fn<CreateLinkFn>(async () => ({ id: "plink_1", short_url: "https://rzp.io/x" }));
    const reply = await executeStartMedicBooking(
      { input: { items: [{ code: "iv_drip", qty: 1, hours: 3 }], payment_mode: "full" } },
      ctx,
      {
        supabase: client,
        loadAndQuoteCartFn: async () => loaded([{ code: "iv_drip", qty: 1, hours: 3 }], [DRIP]),
        createPaymentLink,
      },
    );
    expect(createPaymentLink).toHaveBeenCalledTimes(1);
    const linkArg = createPaymentLink.mock.calls[0][0];
    // Amount is the SERVER prepay (base 199 + drip 399 = 598 → 59800 paise), never a client value.
    expect(linkArg.amountPaise).toBe(59_800);
    expect(linkArg.notes.flow).toBe("aarogya_medic_cart");
    expect(linkArg.notes.charge_paise).toBe("59800");
    expect(linkArg.notes.cart_ref).toBe("cart-ref-123");
    // An intent was written; NO bookings insert happens in the tool.
    expect(calls.inserted.some((c) => (c as { table: string }).table === "medic_cart_intents")).toBe(true);
    expect(calls.inserted.some((c) => (c as { table: string }).table === "bookings")).toBe(false);
    expect(reply).toContain("https://rzp.io/x");
    expect(reply).toContain("₹598");
    expect(reply.toLowerCase()).toContain("clear"); // "confirm the moment it clears"
  });

  it("booking_fee mode charges the flat ₹100 fee, not the full prepay", async () => {
    const { client } = makeSupabase();
    const createPaymentLink = vi.fn<CreateLinkFn>(async () => ({ id: "plink_2", short_url: "https://rzp.io/y" }));
    await executeStartMedicBooking(
      { input: { items: [{ code: "iv_drip", qty: 1 }], payment_mode: "booking_fee" } },
      ctx,
      {
        supabase: client,
        loadAndQuoteCartFn: async () => loaded([{ code: "iv_drip", qty: 1 }], [DRIP]),
        createPaymentLink,
      },
    );
    expect(createPaymentLink.mock.calls[0][0].amountPaise).toBe(10_000); // ₹100 flat
  });

  it("non-patient identity is refused (defense-in-depth)", async () => {
    const { client } = makeSupabase();
    const createPaymentLink = vi.fn();
    const reply = await executeStartMedicBooking(
      { input: { items: [{ code: "iv_drip", qty: 1 }] } },
      { ...ctx, identity: { role: "medic", medicId: "m1", fullName: "M" } as unknown as Identity },
      { supabase: client, loadAndQuoteCartFn: async () => loaded([{ code: "iv_drip", qty: 1 }], [DRIP]), createPaymentLink },
    );
    expect(createPaymentLink).not.toHaveBeenCalled();
    expect(reply).toMatch(/not something I can do here/i);
  });
});
