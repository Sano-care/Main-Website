// Marketing Agent Slice 1 — intake dedupe/merge, consent gate, routing
// (hot→opsAlert, B2B→b2b_prospect), scoring, and the booking closed-loop.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/whatsapp/log", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  maskPhone: (p: string) => p,
}));

import { upsertMarketingLead, mergeConsent } from "@/lib/marketing/leadIntake";
import { routeMarketingLead } from "@/lib/marketing/routing";
import { linkBookingToMarketingLead } from "@/lib/marketing/closedLoop";
import { canEnqueueAarogya } from "@/lib/marketing/consent";
import { scoreLead, HOT_SCORE_THRESHOLD } from "@/lib/marketing/scoring";
import { formatMarketingLeadContext, marketingLeadToOpsAlert } from "@/lib/marketing/opsContext";
import type { ConsentStatus, MarketingLead } from "@/lib/marketing/types";

// ── In-memory fake of the marketing_leads table (enough chain surface for the
//    intake/routing/closed-loop queries; enforces the unique normalized_phone). ─
type Row = Record<string, unknown>;
function makeDb() {
  const rows: Row[] = [];
  let idc = 0;
  const matchAll = (filters: [string, unknown][]) => (r: Row) =>
    filters.every(([c, v]) => r[c] === v);

  function from(table: string) {
    if (table !== "marketing_leads") throw new Error(`unexpected table ${table}`);
    const st: { filters: [string, unknown][]; op: "select" | "insert" | "update" | null; payload: Row | null } = {
      filters: [],
      op: null,
      payload: null,
    };
    const finalize = () => {
      if (st.op === "insert") {
        const p = st.payload as Row;
        if (p.normalized_phone && rows.some((r) => r.normalized_phone === p.normalized_phone)) {
          return { data: null, error: { code: "23505", message: "dup" } };
        }
        const row: Row = {
          id: `ml-${++idc}`,
          created_at: "2026-06-30T00:00:00Z",
          updated_at: "2026-06-30T00:00:00Z",
          score: 0,
          state: "new",
          lifetime_value_paise: 0,
          aarogya_nurture: false,
          campaign: null,
          utm_source: null,
          utm_medium: null,
          utm_content: null,
          utm_term: null,
          gclid: null,
          email_lc: null,
          normalized_phone: null,
          service_intent: null,
          linked_booking_id: null,
          linked_lead_id: null,
          assigned_to: null,
          routed_at: null,
          notes: null,
          last_touch: null,
          consent_status: "none",
          contact: {},
          ...p,
        };
        rows.push(row);
        return { data: row, error: null };
      }
      if (st.op === "update") {
        const matched = rows.filter(matchAll(st.filters));
        matched.forEach((r) => Object.assign(r, st.payload));
        return { data: matched[0] ?? null, error: null };
      }
      const found = rows.find(matchAll(st.filters));
      return { data: found ?? null, error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (c: string, v: unknown) => {
        st.filters.push([c, v]);
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      insert: (p: Row) => {
        st.op = "insert";
        st.payload = p;
        return builder;
      },
      update: (p: Row) => {
        st.op = "update";
        st.payload = p;
        return builder;
      },
      maybeSingle: async () => finalize(),
      single: async () => {
        const r = finalize();
        return r.data ? r : { data: null, error: r.error ?? { message: "no rows" } };
      },
      then: (res: (v: unknown) => void) => res(finalize()),
    };
    return builder;
  }
  return { client: { from } as never, rows };
}

const lead = (over: Partial<MarketingLead> = {}): MarketingLead => ({
  id: "ml-1",
  created_at: "2026-06-30T00:00:00Z",
  updated_at: "2026-06-30T00:00:00Z",
  source: "website_book",
  campaign: null,
  utm_source: null,
  utm_medium: null,
  utm_content: null,
  utm_term: null,
  gclid: null,
  consent_status: "opted_in",
  score: 0,
  state: "new",
  contact: { phone: "+919812345678" },
  last_touch: null,
  normalized_phone: "9812345678",
  email_lc: null,
  service_intent: "medic_home",
  linked_booking_id: null,
  linked_lead_id: null,
  lifetime_value_paise: 0,
  aarogya_nurture: false,
  assigned_to: null,
  routed_at: null,
  notes: null,
  ...over,
});

const NOW = Date.parse("2026-06-30T00:00:00Z");

describe("upsertMarketingLead — dedupe + merge attribution", () => {
  it("first touch → inserts a new lead with first-touch attribution", async () => {
    const { client, rows } = makeDb();
    const res = await upsertMarketingLead(
      {
        source: "meta_ctwa",
        contact: { phone: "+91 98123 45678" },
        campaign: "monsoon",
        utm: { utm_source: "fb", gclid: null },
        service_intent: "medic_home",
        consent_status: "pending",
      },
      { supabase: client, now: "2026-06-30T10:00:00Z" } as never,
    );
    expect(res.created).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("meta_ctwa");
    expect(rows[0].normalized_phone).toBe("9812345678");
    expect(rows[0].consent_status).toBe("pending");
  });

  it("second source on the SAME phone → no duplicate; first-touch source kept, last_touch updated, consent ratchets up", async () => {
    const { client, rows } = makeDb();
    await upsertMarketingLead(
      { source: "justdial", contact: { phone: "9812345678" }, consent_status: "none" },
      { supabase: client } as never,
    );
    const res2 = await upsertMarketingLead(
      { source: "meta_ctwa", contact: { phone: "+919812345678" }, campaign: "ctwa1", consent_status: "opted_in" },
      { supabase: client, now: "2026-06-30T12:00:00Z" } as never,
    );
    expect(res2.created).toBe(false);
    expect(rows).toHaveLength(1); // deduped
    expect(rows[0].source).toBe("justdial"); // first-touch immutable
    expect((rows[0].last_touch as { source: string }).source).toBe("meta_ctwa"); // last-touch
    expect(rows[0].consent_status).toBe("opted_in"); // ratcheted none → opted_in
  });

  it("dedupes on email when no phone is present", async () => {
    const { client, rows } = makeDb();
    await upsertMarketingLead(
      { source: "google_lead_form", contact: { email: "A@X.com" } },
      { supabase: client } as never,
    );
    await upsertMarketingLead(
      { source: "website_callback", contact: { email: "a@x.com" } },
      { supabase: client } as never,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].email_lc).toBe("a@x.com");
  });

  it("mergeConsent ratchets up but keeps opt-out sticky", () => {
    expect(mergeConsent("none", "opted_in")).toBe("opted_in");
    expect(mergeConsent("opted_in", "pending")).toBe("opted_in"); // never downgrade
    expect(mergeConsent("opted_in", "opted_out")).toBe("opted_out"); // explicit opt-out wins
    expect(mergeConsent("opted_out", "opted_in")).toBe("opted_out"); // sticky
  });
});

describe("consent gate", () => {
  it("canEnqueueAarogya is true ONLY for opted_in", () => {
    for (const cs of ["none", "pending", "opted_out"] as ConsentStatus[]) {
      expect(canEnqueueAarogya({ consent_status: cs })).toBe(false);
    }
    expect(canEnqueueAarogya({ consent_status: "opted_in" })).toBe(true);
  });

  it("routing never sets aarogya_nurture true unless opted_in (the DB CHECK is the backstop)", async () => {
    for (const cs of ["none", "pending", "opted_out", "opted_in"] as ConsentStatus[]) {
      const { client } = makeDb();
      const d = await routeMarketingLead(lead({ consent_status: cs }), {
        supabase: client,
        sendOpsAlertFn: vi.fn(async () => ({ sent: true, attempts: 1 })) as never,
        now: NOW,
      });
      expect(d.aarogyaNurture).toBe(cs === "opted_in");
    }
  });
});

describe("routeMarketingLead", () => {
  it("hot B2C → fires sendOpsAlert (to the existing path) with the {{5}} context; opted-in → aarogya_nurture", async () => {
    const { client } = makeDb();
    const opsAlert = vi.fn(async () => ({ sent: true, attempts: 1 }));
    const d = await routeMarketingLead(
      lead({ source: "website_book", consent_status: "opted_in", service_intent: "medic_home" }),
      { supabase: client, sendOpsAlertFn: opsAlert as never, now: NOW },
    );
    expect(d.state).toBe("hot");
    expect(d.score).toBeGreaterThanOrEqual(HOT_SCORE_THRESHOLD);
    expect(d.aarogyaNurture).toBe(true);
    expect(d.opsAlerted).toBe(true);
    expect(opsAlert).toHaveBeenCalledTimes(1);
    const arg = (opsAlert.mock.calls[0] as unknown[])[0] as {
      conversationId: string | null;
      context: string;
      patientMobile: string;
    };
    expect(arg.conversationId).toBeNull(); // marketing lead, no conversation
    expect(arg.context).toMatch(/website_book/);
    expect(arg.context).toMatch(/score \d+/);
    expect(arg.patientMobile).toBe("+919812345678");
  });

  it("non-hot opted-in B2C → nurturing, no ops alert", async () => {
    const { client } = makeDb();
    const opsAlert = vi.fn(async () => ({ sent: true, attempts: 1 }));
    const d = await routeMarketingLead(
      lead({ source: "justdial", consent_status: "opted_in", created_at: "2026-06-01T00:00:00Z" }),
      { supabase: client, sendOpsAlertFn: opsAlert as never, now: NOW },
    );
    expect(d.state).toBe("nurturing");
    expect(d.aarogyaNurture).toBe(true);
    expect(opsAlert).not.toHaveBeenCalled();
  });

  it("hot but NOT opted-in → ops alert fires (internal) but aarogya_nurture stays false", async () => {
    const { client } = makeDb();
    const opsAlert = vi.fn(async () => ({ sent: true, attempts: 1 }));
    const d = await routeMarketingLead(
      lead({ source: "website_book", consent_status: "pending", service_intent: "medic_home" }),
      { supabase: client, sendOpsAlertFn: opsAlert as never, now: NOW },
    );
    expect(d.state).toBe("hot");
    expect(d.opsAlerted).toBe(true);
    expect(d.aarogyaNurture).toBe(false); // consent gate
  });

  it("B2B (society intent) → b2b_prospect, NEVER Aarogya, no ops alert", async () => {
    const { client } = makeDb();
    const opsAlert = vi.fn(async () => ({ sent: true, attempts: 1 }));
    const d = await routeMarketingLead(
      lead({ service_intent: "society", consent_status: "opted_in" }),
      { supabase: client, sendOpsAlertFn: opsAlert as never, now: NOW },
    );
    expect(d.state).toBe("b2b_prospect");
    expect(d.track).toBe("b2b");
    expect(d.aarogyaNurture).toBe(false);
    expect(opsAlert).not.toHaveBeenCalled();
  });

  it("b2b_discovery source → b2b_prospect", async () => {
    const { client } = makeDb();
    const d = await routeMarketingLead(lead({ source: "b2b_discovery", service_intent: null }), {
      supabase: client,
      sendOpsAlertFn: vi.fn(async () => ({ sent: true, attempts: 1 })) as never,
      now: NOW,
    });
    expect(d.state).toBe("b2b_prospect");
  });
});

describe("scoreLead", () => {
  it("is deterministic and bounded 0–100", () => {
    const s = scoreLead({ source: "website_book", service_intent: "medic_home", consent_status: "opted_in", now: NOW });
    expect(s).toBe(40 + 15 + 12 + 25); // fit + intent + consent + fresh recency
    expect(scoreLead({ source: "justdial", consent_status: "none", created_at: "2026-06-01T00:00:00Z", now: NOW })).toBe(20);
  });
});

describe("linkBookingToMarketingLead (closed-loop)", () => {
  it("matches by phone → state=booked, linked_booking_id set, lifetime_value_paise rolled up", async () => {
    const { client, rows } = makeDb();
    await upsertMarketingLead(
      { source: "website_book", contact: { phone: "+919812345678" }, consent_status: "opted_in" },
      { supabase: client } as never,
    );
    rows[0].lifetime_value_paise = 100; // pre-existing paise to roll up

    const res = await linkBookingToMarketingLead(
      { phone: "9812345678", bookingId: "bk-1", amountPaise: 499 },
      { supabase: client },
    );
    expect(res.linked).toBe(true);
    expect(rows[0].state).toBe("booked");
    expect(rows[0].linked_booking_id).toBe("bk-1");
    expect(rows[0].lifetime_value_paise).toBe(599); // 100 + 499 (paise)
  });

  it("no marketing lead for the phone → linked:false, nothing written", async () => {
    const { client } = makeDb();
    const res = await linkBookingToMarketingLead({ phone: "+910000000000", bookingId: "bk-2", amountPaise: 200 }, { supabase: client });
    expect(res.linked).toBe(false);
  });
});

describe("opsContext", () => {
  it("formats the {{5}} context and maps to a conversation-less ops alert", () => {
    const l = lead({ source: "meta_ctwa", campaign: "monsoon", score: 88, notes: "wants medic tonight" });
    expect(formatMarketingLeadContext(l)).toBe("wants medic tonight | meta_ctwa/monsoon, score 88");
    const args = marketingLeadToOpsAlert(l);
    expect(args.conversationId).toBeNull();
    expect(args.escalationId).toBeNull();
    expect(args.patientMobile).toBe("+919812345678");
  });
});
