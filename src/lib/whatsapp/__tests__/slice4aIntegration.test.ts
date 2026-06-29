// Slice 4a C7 — End-to-end integration test for the ops relay flow.
//
// Walks the full draft → confirm → send → audit path through the
// executor surface, with Claude composition + supabase + dispatch all
// mocked. Verifies:
//   1. relay_to_patient produces a draft preview WITH the target phone
//      and the composed body
//   2. an OPS_RELAY_DRAFTED audit row was written
//   3. confirm_relay (YES) sends to the target via dispatchTextMessage
//   4. an OPS_RELAY_CONFIRMED audit row was written
//   5. Identity gate: a non-ops identity gets the OPS_GATE_REJECT message

import { describe, it, expect, vi, beforeEach } from "vitest";

interface AuditRow {
  id: string;
  conversation_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  created_at: string;
}

const h = vi.hoisted(() => ({
  auditRows: [] as AuditRow[],
  nextId: 0,
  dispatched: [] as { conversationId: string; phone: string; body: string }[],
  relayPersists: [] as {
    targetPhone: string;
    body: string;
    providerMessageId: string;
    draftId: string;
  }[],
  storedLanguage: null as string | null,
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "conversations") {
        return {
          select: () => ({
            ilike: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: h.storedLanguage ? { language: h.storedLanguage } : null,
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        };
      }
      // audit_log mock — reused from opsRouter.test.ts
      const query: Record<string, unknown> = {
        select: () => query,
        eq: () => query,
        order: () => query,
        in: () =>
          Promise.resolve({
            data: h.auditRows.filter(
              (r) =>
                r.event_type === "ops_relay_confirmed" ||
                r.event_type === "ops_relay_cancelled" ||
                r.event_type === "ops_relay_expired",
            ),
            error: null,
          }),
        limit: () =>
          Promise.resolve({
            data: [...h.auditRows]
              .filter((r) => r.event_type === "ops_relay_drafted")
              .sort((a, b) => b.created_at.localeCompare(a.created_at)),
            error: null,
          }),
        insert: (row: Omit<AuditRow, "id" | "created_at">) => {
          // commit synchronously so the writeAudit bare-await path captures it
          h.nextId += 1;
          const ts = new Date(2026, 5, 18, 10, 0, h.nextId).toISOString();
          const stored: AuditRow = {
            ...row,
            id: `audit-${h.nextId}`,
            created_at: ts,
          };
          h.auditRows.push(stored);
          const result = {
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: stored.id, created_at: ts }, error: null }),
            }),
            then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
          };
          return result;
        },
      };
      return query;
    },
  },
}));

vi.mock("@/lib/whatsapp/db", () => ({
  dispatchTextMessage: vi.fn(async (args: { conversationId: string; phone: string; body: string }) => {
    h.dispatched.push({ conversationId: args.conversationId, phone: args.phone, body: args.body });
    return { sent: true, providerMessageId: `wamid-${h.dispatched.length}` };
  }),
  persistRelayIntoRecipientThread: vi.fn(
    async (args: { targetPhone: string; body: string; providerMessageId: string; draftId: string }) => {
      h.relayPersists.push(args);
    },
  ),
}));

vi.mock("@/lib/whatsapp/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  maskPhone: (p: string) => p,
}));

import { executeConfirmRelay, executeRelayToPatient } from "@/lib/whatsapp/slice4aExecutors";
import { dispatchTextMessage } from "@/lib/whatsapp/db";

beforeEach(() => {
  h.auditRows = [];
  h.nextId = 0;
  h.dispatched = [];
  h.relayPersists = [];
  h.storedLanguage = null;
});

describe("Slice 4a — ops relay end-to-end", () => {
  it("ops_founder full flow: draft → ops confirms YES → patient receives → audit log entries", async () => {
    h.storedLanguage = "hinglish";

    // 1. Ops drafts
    const draftPreview = await executeRelayToPatient(
      {
        identity: { role: "ops_founder", phone: "+919760059900" },
        opsConversationId: "ops-conv-1",
        input: {
          target_phone: "+919876543210",
          instruction: "tell the patient sorry, medic delayed 15 min",
        },
      },
      {
        // Stub composer — returns a canned line so we don't hit Claude.
        composeDraftBody: async ({ instruction, targetLanguage }) =>
          `Apologies for the delay — ${instruction}. (lang=${targetLanguage})`,
      },
    );

    expect(draftPreview).toContain("Draft to +919876543210");
    expect(draftPreview).toContain("Apologies for the delay");
    expect(draftPreview).toContain("Reply YES to send");

    const draftedRow = h.auditRows.find((r) => r.event_type === "ops_relay_drafted");
    expect(draftedRow).toBeTruthy();
    expect((draftedRow!.event_data as { target_phone: string }).target_phone).toBe("+919876543210");

    // 2. Ops confirms YES
    const confirmPreview = await executeConfirmRelay({
      identity: { role: "ops_founder", phone: "+919760059900" },
      opsConversationId: "ops-conv-1",
      input: { resolution: "YES" },
    });

    expect(confirmPreview).toContain("Sent ✓");
    expect(confirmPreview).toContain("+919876543210");

    // 3. dispatchTextMessage was called with the draft body
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0].phone).toBe("+919876543210");
    expect(h.dispatched[0].body).toContain("Apologies for the delay");
    expect(vi.mocked(dispatchTextMessage)).toHaveBeenCalledTimes(1);

    // 4. ops_relay_confirmed audit row was written
    const confirmedRow = h.auditRows.find((r) => r.event_type === "ops_relay_confirmed");
    expect(confirmedRow).toBeTruthy();
    expect((confirmedRow!.event_data as { draft_id: string }).draft_id).toBe(draftedRow!.id);

    // 5. the relay was persisted into the RECIPIENT's thread (the fix) — exactly
    //    once, with the body + the real wamid + the draft marker.
    expect(h.relayPersists).toHaveLength(1);
    expect(h.relayPersists[0].targetPhone).toBe("+919876543210");
    expect(h.relayPersists[0].body).toContain("Apologies for the delay");
    expect(h.relayPersists[0].providerMessageId).toBe("wamid-1");
    expect(h.relayPersists[0].draftId).toBe(draftedRow!.id);
  });

  it("ops_founder cancels (CANCEL) → no send, ops_relay_cancelled row written", async () => {
    h.storedLanguage = "english";

    await executeRelayToPatient(
      {
        identity: { role: "ops_founder", phone: "+919760059900" },
        opsConversationId: "ops-conv-2",
        input: { target_phone: "+919876543210", instruction: "remind them" },
      },
      { composeDraftBody: async () => "Draft body" },
    );

    const cancel = await executeConfirmRelay({
      identity: { role: "ops_founder", phone: "+919760059900" },
      opsConversationId: "ops-conv-2",
      input: { resolution: "CANCEL" },
    });

    expect(cancel).toContain("Cancelled");
    expect(h.dispatched).toHaveLength(0);
    expect(h.relayPersists).toHaveLength(0); // nothing persisted on cancel
    expect(h.auditRows.find((r) => r.event_type === "ops_relay_cancelled")).toBeTruthy();
  });

  it("non-ops identity → relay_to_patient rejects with OPS_GATE message + no draft created", async () => {
    const out = await executeRelayToPatient(
      {
        identity: { role: "customer", subRole: "registered", customerId: "cus-1" },
        opsConversationId: "conv-customer",
        input: { target_phone: "+919876543210", instruction: "x" },
      },
      { composeDraftBody: async () => "should not be called" },
    );

    expect(out).toContain("only relay messages on behalf of Sanocare ops");
    expect(h.auditRows.find((r) => r.event_type === "ops_relay_drafted")).toBeUndefined();
  });

  it("confirm_relay with no pending draft → friendly 'nothing to confirm' message", async () => {
    const out = await executeConfirmRelay({
      identity: { role: "ops_founder", phone: "+919760059900" },
      opsConversationId: "ops-empty",
      input: { resolution: "YES" },
    });
    expect(out).toContain("No pending draft");
    expect(h.dispatched).toHaveLength(0);
  });

  it("failed send (no wamid) → nothing persisted to the recipient thread", async () => {
    h.storedLanguage = "english";
    await executeRelayToPatient(
      {
        identity: { role: "ops_founder", phone: "+919760059900" },
        opsConversationId: "ops-conv-fail",
        input: { target_phone: "+919876543210", instruction: "remind them" },
      },
      { composeDraftBody: async () => "Draft body" },
    );

    // Next send fails (blocked / no wamid).
    vi.mocked(dispatchTextMessage).mockResolvedValueOnce({ sent: false, blocked: true });

    const out = await executeConfirmRelay({
      identity: { role: "ops_founder", phone: "+919760059900" },
      opsConversationId: "ops-conv-fail",
      input: { resolution: "YES" },
    });

    expect(out).toMatch(/blocked or failed/i);
    expect(h.relayPersists).toHaveLength(0); // no row on a failed send
  });
});
