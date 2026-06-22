// Slice 5b — Feature A: offer sweep behaviour.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/whatsapp/safety/audit", async (orig) => {
  const actual = await orig<typeof import("@/lib/whatsapp/safety/audit")>();
  return { ...actual, writeAudit: vi.fn(async () => true) };
});

import { runCarehubOfferSweep } from "@/lib/whatsapp/carehubOutbound";
import { AuditEvent, writeAudit } from "@/lib/whatsapp/safety/audit";
import type { DispatchResult } from "@/lib/whatsapp/db";

type Lead = { id: string; phone: string; customer_id: string | null };

function fakeSupabase(cfg: {
  leads?: Lead[];
  customers?: Record<string, { full_name: string | null }>;
}) {
  const recorded = { updates: [] as Array<{ payload: Record<string, unknown> }> };
  const client = {
    from(table: string) {
      const st = { table, op: "select" as string, payload: undefined as unknown, filters: {} as Record<string, unknown> };
      const api = {
        select: () => api,
        update: (p: Record<string, unknown>) => { st.op = "update"; st.payload = p; return api; },
        eq: (c: string, v: unknown) => { st.filters[c] = v; return api; },
        is: (c: string, v: unknown) => { st.filters[`${c}#is`] = v; return api; },
        order: () => api,
        limit: () => Promise.resolve({ data: cfg.leads ?? [], error: null }),
        maybeSingle: () => {
          if (st.table === "customers") {
            const cid = st.filters["id"] as string;
            return Promise.resolve({ data: cfg.customers?.[cid] ?? null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
          if (st.op === "update") recorded.updates.push({ payload: st.payload as Record<string, unknown> });
          return Promise.resolve({ data: null, error: null }).then(onF, onR);
        },
      };
      return api;
    },
  };
  return { client: client as never, recorded };
}

const resolveConversation = (async (phone: string) => ({
  conversation: { id: `conv-${phone}`, whatsapp_phone: phone, lead_id: "l", opt_out: false, state: "active" },
  isNew: false,
})) as never;

beforeEach(() => vi.mocked(writeAudit).mockClear());

describe("runCarehubOfferSweep", () => {
  it("flag OFF → sends nothing, audits skipped_flag_off", async () => {
    const dispatchTemplate = vi.fn();
    const { client } = fakeSupabase({ leads: [{ id: "L1", phone: "+9111", customer_id: null }] });
    const res = await runCarehubOfferSweep({
      enabled: false,
      supabase: client,
      dispatchTemplate: dispatchTemplate as never,
      resolveConversation,
    });
    expect(res.ran).toBe(false);
    expect(dispatchTemplate).not.toHaveBeenCalled();
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: AuditEvent.CAREHUB_SKIPPED_FLAG_OFF }),
    );
  });

  it("sent → stamps offer cols + audits offer_sent, first name from customer", async () => {
    const dispatchTemplate = vi.fn(async () => ({ sent: true, providerMessageId: "wamid-1" } as DispatchResult));
    const { client, recorded } = fakeSupabase({
      leads: [{ id: "L1", phone: "+9111", customer_id: "C1" }],
      customers: { C1: { full_name: "Sonia Gupta" } },
    });
    const res = await runCarehubOfferSweep({
      enabled: true, supabase: client, dispatchTemplate: dispatchTemplate as never, resolveConversation,
    });
    expect(res).toMatchObject({ ran: true, considered: 1, sent: 1, blocked: 0, failed: 0 });
    expect(dispatchTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: "aarogya_carehub_offer", vars: { first_name: "Sonia" } }),
    );
    expect(recorded.updates[0].payload).toMatchObject({ offer_send_count: 1, offer_last_wamid: "wamid-1" });
    expect(recorded.updates[0].payload.offer_sent_at).toBeTruthy();
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: AuditEvent.CAREHUB_OFFER_SENT }),
    );
  });

  it("opt_out blocked → left pending (no offer stamp), audited", async () => {
    const dispatchTemplate = vi.fn(async () => ({ sent: false, blocked: true } as DispatchResult));
    const { client, recorded } = fakeSupabase({ leads: [{ id: "L1", phone: "+9111", customer_id: null }] });
    const res = await runCarehubOfferSweep({
      enabled: true, supabase: client, dispatchTemplate: dispatchTemplate as never, resolveConversation,
    });
    expect(res).toMatchObject({ sent: 0, blocked: 1 });
    expect(recorded.updates).toHaveLength(0); // never marked offered
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: AuditEvent.CAREHUB_OFFER_BLOCKED_OPTOUT }),
    );
  });

  it("send failure → counted failed, not stamped", async () => {
    const dispatchTemplate = vi.fn(async () => ({ sent: false, blocked: false, error: "transient" } as DispatchResult));
    const { client, recorded } = fakeSupabase({ leads: [{ id: "L1", phone: "+9111", customer_id: null }] });
    const res = await runCarehubOfferSweep({
      enabled: true, supabase: client, dispatchTemplate: dispatchTemplate as never, resolveConversation,
    });
    expect(res).toMatchObject({ sent: 0, failed: 1 });
    expect(recorded.updates).toHaveLength(0);
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: AuditEvent.CAREHUB_OFFER_FAILED }),
    );
  });

  it("null customer → 'there' fallback; processes every pending lead", async () => {
    const dispatchTemplate = vi.fn(async () => ({ sent: true, providerMessageId: "w" } as DispatchResult));
    const { client } = fakeSupabase({
      leads: [
        { id: "L1", phone: "+9111", customer_id: null },
        { id: "L2", phone: "+9122", customer_id: null },
      ],
    });
    const res = await runCarehubOfferSweep({
      enabled: true, supabase: client, dispatchTemplate: dispatchTemplate as never, resolveConversation,
    });
    expect(res.considered).toBe(2);
    expect(res.sent).toBe(2);
    expect(dispatchTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ vars: { first_name: "there" } }),
    );
  });
});
