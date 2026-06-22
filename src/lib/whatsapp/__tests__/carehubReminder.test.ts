// Slice 5b — Feature B: monthly visit reminder sweep behaviour.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/whatsapp/safety/audit", async (orig) => {
  const actual = await orig<typeof import("@/lib/whatsapp/safety/audit")>();
  return { ...actual, writeAudit: vi.fn(async () => true) };
});

import { runCarehubReminderSweep } from "@/lib/whatsapp/carehubReminder";
import { AuditEvent, writeAudit } from "@/lib/whatsapp/safety/audit";
import type { DispatchResult } from "@/lib/whatsapp/db";

type Sub = { id: string; customer_id: string };

function fakeSupabase(cfg: {
  subs?: Sub[];
  customers?: Record<string, { phone: string | null; full_name: string | null }>;
  claim?: () => { data: { id: string } | null; error: { code?: string } | null };
}) {
  const recorded = { inserts: 0, updates: 0, deletes: 0 };
  const client = {
    from(table: string) {
      const st = { table, op: "select" as string, filters: {} as Record<string, unknown> };
      const api = {
        select: () => api,
        insert: () => { st.op = "insert"; return api; },
        update: () => { st.op = "update"; return api; },
        delete: () => { st.op = "delete"; return api; },
        eq: (c: string, v: unknown) => { st.filters[c] = v; return api; },
        limit: () => Promise.resolve({ data: cfg.subs ?? [], error: null }),
        maybeSingle: () => {
          if (st.table === "customers") {
            return Promise.resolve({ data: cfg.customers?.[st.filters["id"] as string] ?? null, error: null });
          }
          if (st.table === "carehub_reminder_log" && st.op === "insert") {
            recorded.inserts++;
            return Promise.resolve(cfg.claim ? cfg.claim() : { data: { id: "log-1" }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
          if (st.op === "update") recorded.updates++;
          if (st.op === "delete") recorded.deletes++;
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

const now = () => new Date("2026-06-15T06:00:00Z"); // → IST 202606

beforeEach(() => vi.mocked(writeAudit).mockClear());

describe("runCarehubReminderSweep", () => {
  it("flag OFF → nothing, audits skipped_flag_off", async () => {
    const dispatchTemplate = vi.fn();
    const { client } = fakeSupabase({ subs: [{ id: "S1", customer_id: "C1" }] });
    const res = await runCarehubReminderSweep({
      enabled: false, supabase: client, dispatchTemplate: dispatchTemplate as never, resolveConversation, now,
    });
    expect(res.ran).toBe(false);
    expect(dispatchTemplate).not.toHaveBeenCalled();
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: AuditEvent.CAREHUB_SKIPPED_FLAG_OFF }),
    );
  });

  it("claims, sends, records wamid, audits sent", async () => {
    const dispatchTemplate = vi.fn(async () => ({ sent: true, providerMessageId: "wamid-r" } as DispatchResult));
    const { client, recorded } = fakeSupabase({
      subs: [{ id: "S1", customer_id: "C1" }],
      customers: { C1: { phone: "+9111", full_name: "Sonia Gupta" } },
    });
    const res = await runCarehubReminderSweep({
      enabled: true, supabase: client, dispatchTemplate: dispatchTemplate as never, resolveConversation, now,
    });
    expect(res).toMatchObject({ ran: true, considered: 1, sent: 1 });
    expect(recorded.inserts).toBe(1); // claimed
    expect(recorded.updates).toBe(1); // wamid backfilled
    expect(recorded.deletes).toBe(0); // claim kept on success
    expect(dispatchTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: "aarogya_carehub_monthly_visit_reminder",
        vars: { first_name: "Sonia" },
      }),
    );
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: AuditEvent.CAREHUB_REMINDER_SENT }),
    );
  });

  it("already-sent (unique 23505 on claim) → skipped, no send", async () => {
    const dispatchTemplate = vi.fn();
    const { client, recorded } = fakeSupabase({
      subs: [{ id: "S1", customer_id: "C1" }],
      customers: { C1: { phone: "+9111", full_name: "A" } },
      claim: () => ({ data: null, error: { code: "23505" } }),
    });
    const res = await runCarehubReminderSweep({
      enabled: true, supabase: client, dispatchTemplate: dispatchTemplate as never, resolveConversation, now,
    });
    expect(res).toMatchObject({ skippedAlreadySent: 1, sent: 0 });
    expect(dispatchTemplate).not.toHaveBeenCalled();
    expect(recorded.deletes).toBe(0);
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: AuditEvent.CAREHUB_REMINDER_SKIPPED_ALREADY_SENT }),
    );
  });

  it("opt_out block after claim → claim released (deleted), audited", async () => {
    const dispatchTemplate = vi.fn(async () => ({ sent: false, blocked: true } as DispatchResult));
    const { client, recorded } = fakeSupabase({
      subs: [{ id: "S1", customer_id: "C1" }],
      customers: { C1: { phone: "+9111", full_name: "A" } },
    });
    const res = await runCarehubReminderSweep({
      enabled: true, supabase: client, dispatchTemplate: dispatchTemplate as never, resolveConversation, now,
    });
    expect(res).toMatchObject({ blocked: 1, sent: 0 });
    expect(recorded.inserts).toBe(1);
    expect(recorded.deletes).toBe(1); // released so a future run can retry
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: AuditEvent.CAREHUB_REMINDER_BLOCKED_OPTOUT }),
    );
  });

  it("soft visit-booked suppression → skip before claiming", async () => {
    const dispatchTemplate = vi.fn();
    const { client, recorded } = fakeSupabase({
      subs: [{ id: "S1", customer_id: "C1" }],
      customers: { C1: { phone: "+9111", full_name: "A" } },
    });
    const res = await runCarehubReminderSweep({
      enabled: true, supabase: client, dispatchTemplate: dispatchTemplate as never, resolveConversation, now,
      isVisitBookedThisMonth: async () => true,
    });
    expect(res).toMatchObject({ skippedVisitBooked: 1, sent: 0 });
    expect(recorded.inserts).toBe(0); // never claimed
    expect(dispatchTemplate).not.toHaveBeenCalled();
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: AuditEvent.CAREHUB_REMINDER_SKIPPED_VISIT_BOOKED }),
    );
  });

  it("no phone → failed, no claim", async () => {
    const dispatchTemplate = vi.fn();
    const { client, recorded } = fakeSupabase({
      subs: [{ id: "S1", customer_id: "C1" }],
      customers: { C1: { phone: null, full_name: "A" } },
    });
    const res = await runCarehubReminderSweep({
      enabled: true, supabase: client, dispatchTemplate: dispatchTemplate as never, resolveConversation, now,
    });
    expect(res).toMatchObject({ failed: 1, sent: 0 });
    expect(recorded.inserts).toBe(0);
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: AuditEvent.CAREHUB_REMINDER_FAILED }),
    );
  });
});
