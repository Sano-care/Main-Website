// Slice 4a C4 — ops router + relay draft store tests.

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
  templateSends: [] as { to: string; templateName: string; bodyParams: string[] }[],
  templateShouldThrow: false,
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== "audit_log") {
        return {
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        };
      }
      // audit_log mock — supports insert+select+single and the chained
      // select+eq+eq+order+limit / select+eq+in queries used by
      // findLatestUnexpiredRelayDraft.
      const filter = {
        conversation_id: null as string | null,
        event_type: null as string | null,
        event_types_in: null as string[] | null,
      };
      let orderDesc = true;
      let limitN = 5;
      const query: Record<string, unknown> = {
        select: () => query,
        eq: (col: string, val: string) => {
          if (col === "conversation_id") filter.conversation_id = val;
          if (col === "event_type") filter.event_type = val;
          return query;
        },
        in: (col: string, vals: string[]) => {
          if (col === "event_type") filter.event_types_in = vals;
          return Promise.resolve({
            data: h.auditRows.filter(
              (r) =>
                r.conversation_id === filter.conversation_id &&
                vals.includes(r.event_type),
            ),
            error: null,
          });
        },
        order: (_col: string, opts: { ascending: boolean }) => {
          orderDesc = !opts.ascending;
          return query;
        },
        limit: (n: number) => {
          limitN = n;
          let rows = h.auditRows;
          if (filter.conversation_id) {
            rows = rows.filter((r) => r.conversation_id === filter.conversation_id);
          }
          if (filter.event_type) {
            rows = rows.filter((r) => r.event_type === filter.event_type);
          }
          if (orderDesc) {
            rows = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
          }
          return Promise.resolve({ data: rows.slice(0, limitN), error: null });
        },
        insert: (row: Omit<AuditRow, "id" | "created_at">) => ({
          select: () => ({
            single: () => {
              h.nextId += 1;
              // Monotonic timestamp so order tests are deterministic. The
              // DB-side created_at varies by µs; here we anchor to nextId.
              const ts = new Date(2026, 5, 18, 10, 0, h.nextId).toISOString();
              const stored: AuditRow = {
                ...row,
                id: `audit-${h.nextId}`,
                created_at: ts,
              };
              h.auditRows.push(stored);
              return Promise.resolve({ data: { id: stored.id, created_at: stored.created_at }, error: null });
            },
          }),
        }),
      };
      // Bare insert (no .select().single()) used by writeAudit.
      const bareInsert = {
        ...query,
        then: (resolve: (v: { data: null; error: null }) => unknown) =>
          resolve({ data: null, error: null }),
      };
      void bareInsert;
      const queryWithBareInsert = {
        ...query,
        insert: (row: Omit<AuditRow, "id" | "created_at">) => {
          // Detect bare insert from writeAudit (no chained .select())
          const insertResult = (query.insert as (r: unknown) => Record<string, unknown>)(row);
          // Also return a thenable so `await supabaseAdmin.from('audit_log').insert(...)` resolves.
          return Object.assign(insertResult, {
            then: (resolve: (v: { error: null }) => unknown) => {
              // commit to h.auditRows the same way insert+select+single does
              h.nextId += 1;
              h.auditRows.push({
                ...row,
                id: `audit-${h.nextId}`,
                created_at: new Date().toISOString(),
              });
              return resolve({ error: null });
            },
          });
        },
      };
      return queryWithBareInsert;
    },
  },
}));

vi.mock("@/lib/whatsapp/cloud-api", () => ({
  sendTemplateMessage: vi.fn(async (input: { to: string; templateName: string; bodyParams: string[] }) => {
    if (h.templateShouldThrow) throw new Error("send failed");
    h.templateSends.push(input);
    return { providerMessageId: `wamid-${h.templateSends.length}` };
  }),
}));

vi.mock("@/lib/whatsapp/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  maskPhone: (p: string) => p,
}));

import {
  RELAY_DRAFT_TTL_MS,
  createRelayDraft,
  escalateToOpsPhone,
  findLatestUnexpiredRelayDraft,
  markRelayDraftResolved,
  routeInbound,
} from "@/lib/whatsapp/opsRouter";

beforeEach(() => {
  h.auditRows = [];
  h.nextId = 0;
  h.templateSends = [];
  h.templateShouldThrow = false;
});

describe("routeInbound", () => {
  it("ops_founder identity → mode='ops'", () => {
    const d = routeInbound({ role: "ops_founder", phone: "+919760059900" });
    expect(d.mode).toBe("ops");
  });

  it("registered customer → mode='patient'", () => {
    const d = routeInbound({
      role: "customer",
      subRole: "registered",
      customerId: "cus-1",
      fullName: "Rajesh",
    });
    expect(d.mode).toBe("patient");
  });

  it("doctor → mode='patient' (ops mode is founder-only)", () => {
    const d = routeInbound({ role: "doctor", doctorId: "doc-1", fullName: "Dr Asha" });
    expect(d.mode).toBe("patient");
  });

  it("new visitor → mode='patient'", () => {
    expect(routeInbound({ role: "new" }).mode).toBe("patient");
  });
});

describe("escalateToOpsPhone", () => {
  it("sends aarogya_lead_alert with the 6 body params to the Ops number", async () => {
    delete process.env.MY_PERSONAL_WHATSAPP;
    await escalateToOpsPhone({
      conversationId: "conv-1",
      escalationId: "esc-1",
      patientName: "Rajesh Kumar",
      patientAge: "45 y",
      serviceDisplay: "Home Visit",
      location: "Kalkaji",
      context: "Fever for 2 days",
      patientMobile: "+919811100001",
    });
    expect(h.templateSends).toHaveLength(1);
    const sent = h.templateSends[0];
    expect(sent.to).toBe("919760059900"); // hardened default = Ops number, no env required
    expect(sent.templateName).toBe("aarogya_lead_alert");
    expect(sent.bodyParams).toEqual([
      "Rajesh Kumar",
      "45 y",
      "Home Visit",
      "Kalkaji",
      "Fever for 2 days",
      "+919811100001",
    ]);
  });

  it("respects MY_PERSONAL_WHATSAPP override (local-testing path)", async () => {
    process.env.MY_PERSONAL_WHATSAPP = "+918888777777";
    await escalateToOpsPhone({
      conversationId: "conv-1",
      patientName: "X", patientAge: "1", serviceDisplay: "Y",
      location: "Z", context: "W", patientMobile: "+910",
    });
    expect(h.templateSends[0]?.to).toBe("918888777777");
    delete process.env.MY_PERSONAL_WHATSAPP;
  });

  it("never throws on template send failure (best-effort)", async () => {
    h.templateShouldThrow = true;
    await expect(
      escalateToOpsPhone({
        conversationId: "conv-fail",
        patientName: "X", patientAge: "1", serviceDisplay: "Y",
        location: "Z", context: "W", patientMobile: "+910",
      }),
    ).resolves.toEqual({});
  });
});

describe("createRelayDraft + findLatestUnexpiredRelayDraft", () => {
  it("writes OPS_RELAY_DRAFTED with target/draft/expires_at and returns the draft", async () => {
    const now = new Date("2026-06-18T10:00:00Z");
    const draft = await createRelayDraft({
      opsConversationId: "ops-conv-1",
      targetPhone: "+919876543210",
      instruction: "tell the patient sorry for delay",
      draftBody: "Hi Asha — apologies, we're 15 min late. — Aarogya",
      language: "english",
      now,
    });

    expect(draft).not.toBeNull();
    expect(draft!.draftBody).toContain("apologies");
    expect(draft!.targetPhone).toBe("+919876543210");

    const expectedExpiry = new Date(now.getTime() + RELAY_DRAFT_TTL_MS).toISOString();
    expect(draft!.expiresAt).toBe(expectedExpiry);

    // audit row stored
    expect(h.auditRows.find((r) => r.event_type === "ops_relay_drafted")).toBeTruthy();
  });

  it("findLatestUnexpiredRelayDraft returns the most recent unexpired draft", async () => {
    const now = new Date("2026-06-18T10:00:00Z");
    await createRelayDraft({
      opsConversationId: "ops-1",
      targetPhone: "+919876543210",
      instruction: "first",
      draftBody: "Draft A",
      language: "english",
      now: new Date(now.getTime() - 2 * 60 * 1000),
    });
    await createRelayDraft({
      opsConversationId: "ops-1",
      targetPhone: "+919876543210",
      instruction: "second",
      draftBody: "Draft B",
      language: "english",
      now,
    });

    const found = await findLatestUnexpiredRelayDraft("ops-1", now);
    expect(found?.draftBody).toBe("Draft B");
  });

  it("returns null when the latest draft has expired", async () => {
    const composedAt = new Date("2026-06-18T10:00:00Z");
    await createRelayDraft({
      opsConversationId: "ops-x",
      targetPhone: "+919876543210",
      instruction: "stale",
      draftBody: "Old draft",
      language: "english",
      now: composedAt,
    });
    const queryAt = new Date(composedAt.getTime() + RELAY_DRAFT_TTL_MS + 1000);
    const found = await findLatestUnexpiredRelayDraft("ops-x", queryAt);
    expect(found).toBeNull();
  });

  it("skips already-confirmed drafts", async () => {
    const now = new Date("2026-06-18T10:00:00Z");
    const a = await createRelayDraft({
      opsConversationId: "ops-c",
      targetPhone: "+919876543210",
      instruction: "first",
      draftBody: "Draft A",
      language: "english",
      now: new Date(now.getTime() - 2 * 60 * 1000),
    });
    await markRelayDraftResolved({
      opsConversationId: "ops-c",
      draftId: a!.draftId,
      resolution: "confirmed",
      sentWamid: "wamid-1",
    });
    // Draft A is confirmed; query should yield null (no other unresolved).
    const found = await findLatestUnexpiredRelayDraft("ops-c", now);
    expect(found).toBeNull();
  });

  it("markRelayDraftResolved writes the matching ops_relay_* event", async () => {
    const now = new Date("2026-06-18T10:00:00Z");
    const d = await createRelayDraft({
      opsConversationId: "ops-m",
      targetPhone: "+919876543210",
      instruction: "test",
      draftBody: "Body",
      language: "hinglish",
      now,
    });
    await markRelayDraftResolved({
      opsConversationId: "ops-m",
      draftId: d!.draftId,
      resolution: "cancelled",
    });
    expect(h.auditRows.find((r) => r.event_type === "ops_relay_cancelled")).toBeTruthy();
  });

  it("markRelayDraftResolved(expired) writes the expired event", async () => {
    const d = await createRelayDraft({
      opsConversationId: "ops-e",
      targetPhone: "+919876543210",
      instruction: "x",
      draftBody: "y",
      language: null,
    });
    await markRelayDraftResolved({
      opsConversationId: "ops-e",
      draftId: d!.draftId,
      resolution: "expired",
    });
    expect(h.auditRows.find((r) => r.event_type === "ops_relay_expired")).toBeTruthy();
  });
});
