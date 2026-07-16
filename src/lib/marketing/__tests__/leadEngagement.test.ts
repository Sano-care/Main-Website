// Aarogya Lead Engine P1 — sweep (throttle + stop-loss + consented-source only),
// reply→opted_in→qualify→ops-forward, STOP→opted_out, halt.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/whatsapp/cloud-api", () => ({ sendTemplateMessage: vi.fn() }));
vi.mock("@/lib/whatsapp/opsAlert", () => ({
  sendOpsAlert: vi.fn(async () => ({ sent: true, attempts: 1 })),
  OPS_ALERT_TARGET_DIGITS: "919760059900",
}));
vi.mock("@/lib/whatsapp/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  maskPhone: (p: string) => p,
}));

import {
  runLeadEngagementSweep,
  handleLeadReplied,
  markLeadOptedOut,
  haltLeadEngagement,
  T1_DAILY_CAP,
} from "@/lib/marketing/leadEngagement";

type Row = Record<string, unknown>;

// In-memory marketing_leads + control that honours the chained filters the
// engine uses (eq/neq/in/gte/lte/is/order/limit + count-head + select-post-update).
function makeDb(seed: { leads?: Row[]; halted?: boolean } = {}) {
  const leads = (seed.leads ?? []).map((r) => ({ ...r }));
  const control: Row = { id: 1, halted: seed.halted ?? false, halted_reason: null, halted_at: null };

  const from = (table: string) => {
    if (table === "marketing_engagement_control") {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: control, error: null }),
        update: (p: Row) => {
          Object.assign(control, p);
          return { eq: async () => ({ error: null }) };
        },
      };
      return chain;
    }
    if (table !== "marketing_leads") throw new Error(`unexpected table ${table}`);
    const f: [string, string, unknown][] = [];
    let op: "update" | null = null;
    let payload: Row = {};
    let orderCol: string | null = null;
    let asc = true;
    let lim: number | null = null;
    let head = false;
    let counting = false;

    const match = (r: Row) =>
      f.every(([m, c, v]) => {
        const val = r[c];
        switch (m) {
          case "eq":
            return val === v;
          case "neq":
            return val !== v;
          case "in":
            return (v as unknown[]).includes(val);
          case "is":
            return val === v;
          case "gte":
            return val != null && String(val) >= String(v);
          case "lte":
            return val != null && String(val) <= String(v);
          default:
            return true;
        }
      });
    const run = () => {
      let rows = leads.filter(match);
      if (op === "update") {
        rows.forEach((r) => Object.assign(r, payload));
        return rows;
      }
      if (orderCol) {
        const oc = orderCol;
        rows = [...rows].sort((a, b) => (String(a[oc]) < String(b[oc]) ? -1 : 1) * (asc ? 1 : -1));
      }
      if (lim != null) rows = rows.slice(0, lim);
      return rows;
    };
    const chain: Record<string, unknown> = {
      select: (_c?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count) counting = true;
        if (opts?.head) head = true;
        return chain;
      },
      eq: (c: string, v: unknown) => (f.push(["eq", c, v]), chain),
      neq: (c: string, v: unknown) => (f.push(["neq", c, v]), chain),
      in: (c: string, v: unknown) => (f.push(["in", c, v]), chain),
      is: (c: string, v: unknown) => (f.push(["is", c, v]), chain),
      gte: (c: string, v: unknown) => (f.push(["gte", c, v]), chain),
      lte: (c: string, v: unknown) => (f.push(["lte", c, v]), chain),
      order: (c: string, o?: { ascending?: boolean }) => {
        orderCol = c;
        asc = o?.ascending !== false;
        return chain;
      },
      limit: (n: number) => ((lim = n), chain),
      update: (p: Row) => ((op = "update"), (payload = p), chain),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (res: (v: unknown) => void) => {
        if (counting && head) return res({ count: run().length, error: null, data: null });
        return res({ data: run(), error: null });
      },
    };
    return chain;
  };
  return { client: { from } as never, leads, control };
}

const lead = (over: Row = {}): Row => ({
  id: `ml-${Math.random().toString(36).slice(2, 8)}`,
  source: "justdial",
  campaign: "jd_listing",
  consent_status: "pending",
  state: "new",
  service_intent: "medic_home",
  contact: { phone: "+919812345678" },
  normalized_phone: "9812345678",
  notes: "JD#T1 | Home Nursing | Kalkaji, Delhi",
  engagement_state: "none",
  t1_sent_at: null,
  t2_sent_at: null,
  last_inbound_at: null,
  created_at: "2026-07-14T00:00:00Z",
  ...over,
});

const NOW = new Date("2026-07-16T12:00:00Z");
const baseDeps = (client: never, over: Record<string, unknown> = {}) => ({
  supabase: client,
  sendTemplate: vi.fn(async () => ({ providerMessageId: "wamid-x" })),
  sendOpsAlertFn: vi.fn(async () => ({ sent: true, attempts: 1 })),
  writeAuditFn: vi.fn(async () => true),
  now: NOW,
  enabled: true,
  ...over,
});

describe("runLeadEngagementSweep", () => {
  it("flag OFF → inert (ran:false, no sends)", async () => {
    const { client } = makeDb({ leads: [lead()] });
    const deps = baseDeps(client, { enabled: false });
    const r = await runLeadEngagementSweep(deps as never);
    expect(r.ran).toBe(false);
    expect(r.reason).toBe("flag_off");
    expect(deps.sendTemplate).not.toHaveBeenCalled();
  });

  it("WABA stop-loss halted → no sends", async () => {
    const { client } = makeDb({ leads: [lead()], halted: true });
    const deps = baseDeps(client);
    const r = await runLeadEngagementSweep(deps as never);
    expect(r.reason).toBe("halted");
    expect(deps.sendTemplate).not.toHaveBeenCalled();
  });

  it("enabled → sends T1 to eligible pending justdial leads, marks t1_sent", async () => {
    const { client, leads } = makeDb({ leads: [lead({ id: "a" })] });
    const deps = baseDeps(client);
    const r = await runLeadEngagementSweep(deps as never);
    expect(r.t1Sent).toBe(1);
    expect(deps.sendTemplate).toHaveBeenCalledTimes(1);
    expect(leads[0].engagement_state).toBe("t1_sent");
    expect(leads[0].t1_sent_at).toBe(NOW.toISOString());
  });

  it("only contact-consented sources are engaged (website_book excluded)", async () => {
    const { client } = makeDb({ leads: [lead({ id: "w", source: "website_book" })] });
    const deps = baseDeps(client);
    const r = await runLeadEngagementSweep(deps as never);
    expect(r.t1Sent).toBe(0);
    expect(deps.sendTemplate).not.toHaveBeenCalled();
  });

  it("throttles T1 to the daily cap (already-sent-today count consumes it)", async () => {
    const sentToday = Array.from({ length: T1_DAILY_CAP - 1 }, (_, i) =>
      lead({ id: `s${i}`, engagement_state: "t1_sent", t1_sent_at: NOW.toISOString() }),
    );
    const fresh = [lead({ id: "f1" }), lead({ id: "f2" }), lead({ id: "f3" })];
    const { client } = makeDb({ leads: [...sentToday, ...fresh] });
    const deps = baseDeps(client);
    const r = await runLeadEngagementSweep(deps as never);
    expect(r.t1Sent).toBe(1); // cap - (cap-1) = 1 remaining
  });

  it("T2: single 48h follow-up when T1 got no reply", async () => {
    const old = lead({
      id: "t1old",
      engagement_state: "t1_sent",
      t1_sent_at: "2026-07-13T00:00:00Z", // >48h before NOW
      last_inbound_at: null,
    });
    const { client, leads } = makeDb({ leads: [old] });
    const deps = baseDeps(client);
    const r = await runLeadEngagementSweep(deps as never);
    expect(r.t2Sent).toBe(1);
    expect(leads[0].engagement_state).toBe("t2_sent");
  });
});

describe("handleLeadReplied", () => {
  it("engaged lead replies → opted_in + qualified + forwarded to ops", async () => {
    const { client, leads } = makeDb({ leads: [lead({ id: "r1", engagement_state: "t1_sent" })] });
    const deps = baseDeps(client);
    const r = await handleLeadReplied("+919812345678", deps as never);
    expect(r.updated).toBe(true);
    expect(r.qualified).toBe(true);
    expect(leads[0].consent_status).toBe("opted_in");
    expect(leads[0].state).toBe("qualified");
    expect(deps.sendOpsAlertFn).toHaveBeenCalledTimes(1); // the ONLY ops ping
  });

  it("no engaged lead for the phone → no-op, no ops ping", async () => {
    const { client } = makeDb({ leads: [] });
    const deps = baseDeps(client);
    const r = await handleLeadReplied("+910000000000", deps as never);
    expect(r.updated).toBe(false);
    expect(deps.sendOpsAlertFn).not.toHaveBeenCalled();
  });

  it("replied but no service_intent → opted_in only, NOT forwarded", async () => {
    const { client, leads } = makeDb({
      leads: [lead({ id: "r2", engagement_state: "t1_sent", service_intent: null })],
    });
    const deps = baseDeps(client);
    const r = await handleLeadReplied("+919812345678", deps as never);
    expect(r.qualified).toBe(false);
    expect(leads[0].consent_status).toBe("opted_in");
    expect(deps.sendOpsAlertFn).not.toHaveBeenCalled();
  });
});

describe("markLeadOptedOut", () => {
  it("STOP → marketing lead consent_status + engagement_state = opted_out", async () => {
    const { client, leads } = makeDb({ leads: [lead({ id: "o1", engagement_state: "t1_sent" })] });
    const deps = baseDeps(client);
    const r = await markLeadOptedOut("+919812345678", deps as never);
    expect(r.optedOut).toBe(true);
    expect(leads[0].consent_status).toBe("opted_out");
    expect(leads[0].engagement_state).toBe("opted_out");
  });
});

describe("haltLeadEngagement (WABA stop-loss)", () => {
  it("trips the control row + loudly alerts the founder", async () => {
    const { client, control } = makeDb({});
    const deps = baseDeps(client);
    await haltLeadEngagement("quality dropped to MEDIUM", deps as never);
    expect(control.halted).toBe(true);
    expect(control.halted_reason).toBe("quality dropped to MEDIUM");
    expect(deps.sendOpsAlertFn).toHaveBeenCalledTimes(1);
  });
});
