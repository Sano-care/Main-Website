import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock the service-role Supabase client. Each .from(table) chain is a
//    thenable that resolves to the scripted rows for that table. ────────────
const rows: Record<string, { data: unknown; error: unknown }> = {};
const single: Record<string, { data: unknown; error: unknown }> = {};

function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "in", "eq"]) b[m] = () => b;
  b.maybeSingle = () =>
    Promise.resolve(single[table] ?? { data: null, error: null });
  b.then = (resolve: (v: unknown) => void) =>
    resolve(rows[table] ?? { data: [], error: null });
  return b;
}

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (t: string) => builder(t) },
}));

// `server-only` is a Next runtime guard with no resolvable package under vitest.
vi.mock("server-only", () => ({}));

import { getConversationMeta, getThread, listConversations } from "./data";
import {
  HIDDEN_AUDIT_TYPES,
  isWithinActiveWindow,
  matchesFilter,
  matchesSearch,
  redactPhone,
  relativeTime,
  telHref,
  type ConversationRow,
} from "./types";

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  for (const k of Object.keys(single)) delete single[k];
});

// ── Data layer ─────────────────────────────────────────────────────────────

describe("listConversations", () => {
  it("assembles last message, count, and audit flags; preserves order", async () => {
    rows.conversations = {
      data: [
        { id: "c1", whatsapp_phone: "919812345678", state: "qualified", service_intent: "lab", escalation_status: "none", opt_out: false, last_user_msg_at: "2026-06-18T10:00:00Z", last_bot_msg_at: "2026-06-18T10:01:00Z", created_at: "2026-06-18T09:00:00Z", updated_at: "2026-06-18T10:01:00Z" },
        { id: "c2", whatsapp_phone: "919760059900", state: "escalated", service_intent: null, escalation_status: "requested", opt_out: true, last_user_msg_at: null, last_bot_msg_at: null, created_at: "2026-06-17T09:00:00Z", updated_at: "2026-06-17T09:00:00Z" },
      ],
      error: null,
    };
    rows.messages = {
      data: [
        { conversation_id: "c1", direction: "outbound", content: "latest c1", created_at: "2026-06-18T10:01:00Z" },
        { conversation_id: "c1", direction: "inbound", content: "older c1", created_at: "2026-06-18T10:00:00Z" },
        { conversation_id: "c2", direction: "inbound", content: "hi c2", created_at: "2026-06-17T09:00:00Z" },
      ],
      error: null,
    };
    rows.audit_log = {
      data: [
        { conversation_id: "c1", event_type: "emergency_detected" },
        { conversation_id: "c1", event_type: "outbound_send_failed_permanent" },
        { conversation_id: "c2", event_type: "escalation_created" },
      ],
      error: null,
    };

    const out = await listConversations();
    expect(out.map((c) => c.id)).toEqual(["c1", "c2"]); // order preserved
    const c1 = out[0];
    expect(c1.lastMessage).toEqual({ direction: "outbound", content: "latest c1" });
    expect(c1.messageCount).toBe(2);
    expect(c1.hasEmergency).toBe(true);
    expect(c1.hasError).toBe(true);
    expect(c1.lastActivityAt).toBe("2026-06-18T10:01:00Z");
    expect(out[1].hasEscalation).toBe(true);
    expect(out[1].optOut).toBe(true);
  });

  it("returns [] when there are no conversations", async () => {
    rows.conversations = { data: [], error: null };
    expect(await listConversations()).toEqual([]);
  });
});

describe("getThread", () => {
  it("merges messages + audit, drops hidden audit types, sorts by time", async () => {
    rows.messages = {
      data: [
        { id: "m1", direction: "inbound", content: "hi", content_type: "text", claude_model_used: null, claude_tokens_out: null, created_at: "2026-06-18T10:00:00Z" },
        { id: "m2", direction: "outbound", content: "namaste", content_type: "text", claude_model_used: "claude-haiku-4-5-20251001", claude_tokens_out: 40, created_at: "2026-06-18T10:00:05Z" },
      ],
      error: null,
    };
    rows.audit_log = {
      data: [
        { id: "a1", event_type: "message_received", event_data: {}, created_at: "2026-06-18T10:00:00Z" }, // hidden
        { id: "a2", event_type: "outbound_sent", event_data: { wamid: "x" }, created_at: "2026-06-18T10:00:06Z" },
        { id: "a3", event_type: "agent_response", event_data: {}, created_at: "2026-06-18T10:00:04Z" }, // hidden
      ],
      error: null,
    };
    const thread = await getThread("c1");
    expect(thread.map((t) => (t.kind === "message" ? `m:${t.id}` : `a:${t.id}`))).toEqual([
      "m:m1",
      "m:m2",
      "a:a2",
    ]);
  });
});

describe("getConversationMeta", () => {
  it("aggregates token total + distinct models", async () => {
    single.conversations = {
      data: { id: "c1", whatsapp_phone: "919812345678", state: "qualified", service_intent: "lab", escalation_status: "none", opt_out: false, created_at: "2026-06-18T09:00:00Z" },
      error: null,
    };
    rows.messages = {
      data: [
        { claude_model_used: "claude-haiku-4-5-20251001", claude_tokens_out: 40 },
        { claude_model_used: "claude-sonnet-4-6", claude_tokens_out: 120 },
        { claude_model_used: "claude-haiku-4-5-20251001", claude_tokens_out: 30 },
      ],
      error: null,
    };
    const meta = await getConversationMeta("c1");
    expect(meta?.messageCount).toBe(3);
    expect(meta?.totalTokensOut).toBe(190);
    expect(meta?.modelsUsed.sort()).toEqual(["claude-haiku-4-5-20251001", "claude-sonnet-4-6"]);
  });

  it("returns null for an unknown conversation", async () => {
    single.conversations = { data: null, error: null };
    expect(await getConversationMeta("nope")).toBeNull();
  });
});

// ── Pure helpers ─────────────────────────────────────────────────────────────

function row(p: Partial<ConversationRow>): ConversationRow {
  return {
    id: "x", phone: "919812345678", state: "qualified", serviceIntent: "lab",
    escalationStatus: "none", optOut: false,
    lastActivityAt: "2026-06-18T11:00:00Z", isActive: true, timeSinceLabel: "1h",
    lastMessage: { direction: "inbound", content: "hello world" },
    messageCount: 1, hasEmergency: false, hasEscalation: false, hasError: false,
    ...p,
  };
}

describe("matchesFilter", () => {
  it("all → always true", () => expect(matchesFilter(row({}), "all")).toBe(true));
  it("active → reads the server-baked isActive flag", () => {
    expect(matchesFilter(row({ isActive: true }), "active")).toBe(true);
    expect(matchesFilter(row({ isActive: false }), "active")).toBe(false);
  });
  it("escalated → flag OR non-none status", () => {
    expect(matchesFilter(row({ hasEscalation: true }), "escalated")).toBe(true);
    expect(matchesFilter(row({ escalationStatus: "requested" }), "escalated")).toBe(true);
    expect(matchesFilter(row({}), "escalated")).toBe(false);
  });
  it("emergency / errors / optout map to their flags", () => {
    expect(matchesFilter(row({ hasEmergency: true }), "emergency")).toBe(true);
    expect(matchesFilter(row({ hasError: true }), "errors")).toBe(true);
    expect(matchesFilter(row({ optOut: true }), "optout")).toBe(true);
    expect(matchesFilter(row({}), "emergency")).toBe(false);
  });
});

describe("time helpers (server-baked)", () => {
  const now = Date.parse("2026-06-18T12:00:00Z");
  it("isWithinActiveWindow → 24h boundary", () => {
    expect(isWithinActiveWindow("2026-06-18T11:00:00Z", now)).toBe(true);
    expect(isWithinActiveWindow("2026-06-16T11:00:00Z", now)).toBe(false);
  });
  it("relativeTime → compact labels", () => {
    expect(relativeTime("2026-06-18T11:58:00Z", now)).toBe("2m");
    expect(relativeTime("2026-06-18T09:00:00Z", now)).toBe("3h");
    expect(relativeTime("2026-06-16T12:00:00Z", now)).toBe("2d");
    expect(relativeTime("2026-06-18T12:00:00Z", now)).toBe("just now");
  });
});

describe("matchesSearch", () => {
  it("empty query matches everything", () => expect(matchesSearch(row({}), "")).toBe(true));
  it("matches phone digit substring", () => {
    expect(matchesSearch(row({ phone: "919812345678" }), "98123")).toBe(true);
    expect(matchesSearch(row({ phone: "919812345678" }), "0000")).toBe(false);
  });
  it("matches message content substring (case-insensitive)", () => {
    expect(matchesSearch(row({ lastMessage: { direction: "inbound", content: "Need a lab test" } }), "lab")).toBe(true);
  });
});

describe("redactPhone + telHref", () => {
  it("masks middle digits, keeps last 4", () => {
    expect(redactPhone("+91 97119 77782")).toBe("+91xxxxxx7782");
    expect(redactPhone("919812345678")).toBe("+91xxxxxx5678");
  });
  it("builds a +91 tel href", () => {
    expect(telHref("919812345678")).toBe("tel:+919812345678");
    expect(telHref("9812345678")).toBe("tel:+919812345678");
  });
});

describe("HIDDEN_AUDIT_TYPES", () => {
  it("hides the bubble-duplicating event types", () => {
    expect(HIDDEN_AUDIT_TYPES.has("agent_response")).toBe(true);
    expect(HIDDEN_AUDIT_TYPES.has("message_received")).toBe(true);
    expect(HIDDEN_AUDIT_TYPES.has("emergency_detected")).toBe(false);
  });
});
