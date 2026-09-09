// Aarogya Medic-at-Home cart tools — money-path tests.
//  - §1 query tokenization + OR-match search (noisy NL phrasings resolve)
//  - pricing engine correctness vs catalog (drip stacking + `from` floor)
//  - Rx-required routing: rx='yes' quotes but NEVER self-books (routes to ops)
//  - self-serve: server-priced payment link, amount price-locked from the
//    catalog (never a client/model value), and NO booking is created here
//  - §3: the cart intent is written via the SERVICE-ROLE admin client (the
//    table is RLS deny-all), not the adapter's request client
//  - receipt-only: the only booking creator is the webhook, not these tools

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// §3: createCartIntent/attachLinkToIntent write via supabaseAdmin. Expose an
// inspectable admin client per-test via a hoisted holder (the real one is
// service-role; tests set a chainable mock).
const adminH = vi.hoisted(() => ({
  ref: null as null | { from: (t: string) => unknown },
}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => {
      if (!adminH.ref) throw new Error("test: supabaseAdmin used before useAdmin()");
      return adminH.ref.from(t);
    },
  },
}));
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
  searchMedicProcedures,
  tokenizeProcedureQuery,
  type CreatedPaymentLink,
  type MedicSearchRow,
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

// ── §1: query tokenization ──────────────────────────────────────────────────
describe("tokenizeProcedureQuery", () => {
  it.each([
    ["injection", ["injection"]],
    ["Intramuscular injection IM", ["intramuscular", "injection", "im"]],
    ["1 IM injection at home", ["im", "injection"]],
    ["IV drip 2 hours", ["iv", "drip"]],
    ["wound dressing", ["wound", "dressing"]],
    ["i need 2 IM injections please", ["im", "injections"]],
  ])("%s → %j", (input, expected) => {
    expect(tokenizeProcedureQuery(input as string)).toEqual(expected);
  });

  it("drops pure filler to empty", () => {
    expect(tokenizeProcedureQuery("at home please for me")).toEqual([]);
  });
});

// ── §1: OR-match search resolves noisy phrasings to the right rows ───────────
const CATALOG: MedicSearchRow[] = [
  { code: "intramuscular_im_injection", name: "Intramuscular (IM) injection", category: "Injections & Infusions", display_order: 1 },
  { code: "subcutaneous_sc_injection", name: "Subcutaneous (SC) injection", category: "Injections & Infusions", display_order: 2 },
  { code: "iv_drip", name: "IV Drip", category: "Injections / IV therapy", display_order: 4 },
  { code: "simple_wound_dressing", name: "Simple wound dressing", category: "Wound & Skin Care", display_order: 6 },
  { code: "catheter_care", name: "Catheter care", category: "Catheter, Elimination & Ostomy", display_order: 20 },
].map((r) => ({ ...r, tier: "standard", is_base_included: false, absolute_price_paise: 0, delta_paise: 19_900, price_type: "fixed", rx_required: null }) as unknown as MedicSearchRow);

/**
 * Mock that faithfully simulates the PostgREST `.or(name.ilike.%t%,category.ilike.%t%,…)`
 * → returns catalog rows where ANY clause substring-matches its field (case-insensitive),
 * ordered by display_order.
 */
function makeCatalogClient() {
  let orClause = "";
  const node: Record<string, unknown> = {
    select: () => node,
    eq: () => node,
    or: (c: string) => {
      orClause = c;
      return node;
    },
    order: () => node,
    limit: async (n: number) => {
      const clauses = orClause.split(",").map((c) => {
        const m = /^(name|category)\.ilike\.%(.+)%$/.exec(c.trim());
        return m ? { field: m[1] as "name" | "category", needle: m[2].toLowerCase() } : null;
      });
      const rows = CATALOG.filter((r) =>
        clauses.some(
          (cl) => cl && String(r[cl.field] ?? "").toLowerCase().includes(cl.needle),
        ),
      )
        .sort(
          (a, b) =>
            ((a as { display_order?: number }).display_order ?? 0) -
            ((b as { display_order?: number }).display_order ?? 0),
        )
        .slice(0, n);
      return { data: rows, error: null };
    },
  };
  return { client: { from: () => node } as never, getOrClause: () => orClause };
}

describe("searchMedicProcedures — tokenized OR-match", () => {
  const codesFor = async (query: string) => {
    const { client } = makeCatalogClient();
    const rows = await searchMedicProcedures(client, query, 6);
    return rows.map((r) => r.code);
  };

  it.each([
    "injection",
    "Intramuscular injection IM",
    "IM injection",
    "1 IM injection at home",
  ])("'%s' resolves to intramuscular_im_injection", async (q) => {
    const codes = await codesFor(q);
    expect(codes).toContain("intramuscular_im_injection");
    // display_order 1 → ranked first among the injection matches
    expect(codes[0]).toBe("intramuscular_im_injection");
  });

  it("'IV drip 2 hours' resolves to iv_drip", async () => {
    expect(await codesFor("IV drip 2 hours")).toContain("iv_drip");
  });

  it("'wound dressing' resolves to simple_wound_dressing", async () => {
    expect(await codesFor("wound dressing")).toContain("simple_wound_dressing");
  });

  it("the OLD whole-string pattern would have matched nothing (regression guard)", async () => {
    // "1 IM injection at home" as a single ILIKE %…% matches no name/category.
    const single = CATALOG.filter(
      (r) =>
        `${r.name} ${r.category}`.toLowerCase().includes("1 im injection at home"),
    );
    expect(single).toHaveLength(0);
    // …but the tokenized search does resolve it:
    expect(await codesFor("1 IM injection at home")).toContain("intramuscular_im_injection");
  });
});

// ── pricing engine correctness (the numbers Aarogya must quote) ──
describe("computeCartQuote — canonical model", () => {
  it("drip stacks on the ₹199 base: 1 drip, 3h → prepay 598, at-visit 300", () => {
    const q = computeCartQuote([{ code: "iv_drip", qty: 1, hours: 3 }], [DRIP]);
    expect(q.prepay_paise).toBe(19_900 + 39_900);
    expect(q.at_visit_paise).toBe(2 * 15_000);
    expect(q.total_paise).toBe(q.prepay_paise + q.at_visit_paise);
    const drip = q.line_items.find((l) => l.code === "iv_drip")!;
    expect(drip.is_variable).toBe(true);
  });

  it("`from` items prepay the floor and flag variable", () => {
    const q = computeCartQuote([{ code: "catheter", qty: 1 }], [FROM_ITEM]);
    expect(q.prepay_paise).toBe(19_900 + 60_000);
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

/** Minimal chainable supabase for the customers read + (admin) intent writes. */
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

/** Install a fresh inspectable admin client (for the intent writes). */
function useAdmin() {
  const a = makeSupabase();
  adminH.ref = a.client as unknown as { from: (t: string) => unknown };
  return a;
}

const ctx = {
  identity: patient,
  phone: "+919812345678",
  conversationId: "conv-1",
  customerId: "cust-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  adminH.ref = null;
});

describe("executeQuoteMedicCart", () => {
  it("returns the exact pay-now amount + flags at-visit variable + Rx note", async () => {
    const { client } = makeSupabase();
    const reply = await executeQuoteMedicCart(
      { identity: patient, input: { items: [{ code: "iv_drip", qty: 1, hours: 3 }] } },
      { supabase: client, loadAndQuoteCartFn: async () => loaded([{ code: "iv_drip", qty: 1, hours: 3 }], [DRIP], { rxYes: ["iv_drip"] }) },
    );
    expect(reply).toContain("₹598");
    expect(reply.toLowerCase()).toContain("at the visit");
    expect(reply.toLowerCase()).toContain("prescription");
  });
});

describe("executeStartMedicBooking — Rx routing (§5.4)", () => {
  it("rx_required='yes' → routes to ops, sends NO payment link, creates NO intent", async () => {
    const { client } = makeSupabase();
    const admin = useAdmin();
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
    expect(sendOpsAlertFn).toHaveBeenCalledTimes(1);
    expect(createPaymentLink).not.toHaveBeenCalled();
    expect(admin.calls.inserted).toHaveLength(0); // no cart intent written
    expect(reply.toLowerCase()).toContain("prescription");
    expect(reply.toLowerCase()).toContain("don't need to pay");
  });
});

describe("executeStartMedicBooking — self-serve (non-Rx)", () => {
  it("price-locks the link + writes the intent via the SERVICE-ROLE admin client", async () => {
    const { client, calls: reqCalls } = makeSupabase();
    const admin = useAdmin();
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
    expect(linkArg.amountPaise).toBe(59_800);
    expect(linkArg.notes.flow).toBe("aarogya_medic_cart");
    expect(linkArg.notes.charge_paise).toBe("59800");
    expect(linkArg.notes.cart_ref).toBe("cart-ref-123");
    // §3: the intent INSERT went through the admin (service-role) client…
    expect(admin.calls.inserted.some((c) => (c as { table: string }).table === "medic_cart_intents")).toBe(true);
    expect(admin.calls.updated.some((c) => (c as { table: string }).table === "medic_cart_intents")).toBe(true); // attachLink
    // …NOT the request-scoped client (which is RLS deny-all on this table),
    // and no bookings insert happens in the tool (receipt-only).
    expect(reqCalls.inserted.some((c) => (c as { table: string }).table === "medic_cart_intents")).toBe(false);
    expect(admin.calls.inserted.some((c) => (c as { table: string }).table === "bookings")).toBe(false);
    expect(reply).toContain("https://rzp.io/x");
    expect(reply).toContain("₹598");
    expect(reply.toLowerCase()).toContain("clear");
  });

  it("booking_fee mode charges the flat ₹100 fee, not the full prepay", async () => {
    const { client } = makeSupabase();
    useAdmin();
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
    expect(createPaymentLink.mock.calls[0][0].amountPaise).toBe(10_000);
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
