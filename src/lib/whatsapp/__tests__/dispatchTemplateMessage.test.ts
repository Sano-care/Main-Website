// Slice 3 C2 — dispatchTemplateMessage tests.
//
// Mirrors the dispatchTextMessage shape: opt-out re-read, OPT_OUT_SEND_BLOCKED
// audit on block, delegation to sendHardenedTemplate on the happy path.
// Existing sender.test.ts covers sendHardenedTemplate internals — these tests
// focus on the new chokepoint's contract.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockState {
  optOut: boolean;
  readErr: string | null;
  audits: Array<{ type: string; data: Record<string, unknown> }>;
  sendResult:
    | { ok: true; providerMessageId?: string; attemptsUsed: number; deduped?: boolean }
    | { ok: false; reason: "session_expired" }
    | { ok: false; reason: "permanent" | "transient_exhausted"; error: { classification: string }; attemptsUsed: number };
}

const h = vi.hoisted(() => ({
  optOut: false,
  readErr: null as string | null,
  audits: [] as MockState["audits"],
  sendResult: { ok: true, providerMessageId: "wamid-1", attemptsUsed: 1 } as MockState["sendResult"],
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: h.readErr ? null : { opt_out: h.optOut },
              error: h.readErr ? { message: h.readErr } : null,
            }),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/whatsapp/safety/audit", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    writeAudit: vi.fn(async (e: { eventType: string; eventData?: Record<string, unknown> }) => {
      h.audits.push({ type: e.eventType, data: e.eventData ?? {} });
      return true;
    }),
  };
});

vi.mock("@/lib/whatsapp/sender", () => ({
  sendHardenedText: vi.fn(),
  sendHardenedTemplate: vi.fn(async () => h.sendResult),
}));

vi.mock("@/lib/whatsapp/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  maskPhone: (p: string) => p,
}));

import { dispatchTemplateMessage } from "@/lib/whatsapp/db";
import { sendHardenedTemplate } from "@/lib/whatsapp/sender";

beforeEach(() => {
  h.optOut = false;
  h.readErr = null;
  h.audits = [];
  h.sendResult = { ok: true, providerMessageId: "wamid-1", attemptsUsed: 1 };
  vi.mocked(sendHardenedTemplate).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dispatchTemplateMessage", () => {
  it("happy path: opt-out clear → delegates to sendHardenedTemplate and returns providerMessageId", async () => {
    const result = await dispatchTemplateMessage({
      conversationId: "conv-1",
      phone: "+919811100001",
      templateName: "aarogya_medic_departed",
      vars: { medic_first_name: "Sunita" },
    });
    expect(result).toEqual({ sent: true, providerMessageId: "wamid-1" });
    expect(sendHardenedTemplate).toHaveBeenCalledTimes(1);
    expect(h.audits.find((a) => a.type === "opt_out_send_blocked")).toBeUndefined();
  });

  it("opt-out block: returns blocked, writes OPT_OUT_SEND_BLOCKED with template_name, never calls sender", async () => {
    h.optOut = true;
    const result = await dispatchTemplateMessage({
      conversationId: "conv-2",
      phone: "+919811100001",
      templateName: "aarogya_medic_departed",
      vars: { medic_first_name: "Sunita" },
    });
    expect(result).toEqual({ sent: false, blocked: true });
    expect(sendHardenedTemplate).not.toHaveBeenCalled();
    const blockedAudit = h.audits.find((a) => a.type === "opt_out_send_blocked");
    expect(blockedAudit).toBeTruthy();
    expect(blockedAudit?.data.template_name).toBe("aarogya_medic_departed");
  });

  it("unknown template → refuses without calling sender", async () => {
    const result = await dispatchTemplateMessage({
      conversationId: "conv-3",
      phone: "+919811100001",
      templateName: "not_registered_template",
      vars: { foo: "bar" },
    });
    expect(result).toEqual({ sent: false, blocked: false, error: "unknown_template" });
    expect(sendHardenedTemplate).not.toHaveBeenCalled();
  });

  it("opt-out precheck read error → returns precheck_failed error, never sends", async () => {
    h.readErr = "supabase down";
    const result = await dispatchTemplateMessage({
      conversationId: "conv-4",
      phone: "+919811100001",
      templateName: "aarogya_medic_departed",
      vars: { medic_first_name: "Sunita" },
    });
    expect(result).toEqual({ sent: false, blocked: false, error: "opt_out_precheck_failed" });
    expect(sendHardenedTemplate).not.toHaveBeenCalled();
  });

  it("send failure (permanent) → returns classification error", async () => {
    h.sendResult = {
      ok: false,
      reason: "permanent",
      error: { classification: "permanent_template_paused" },
      attemptsUsed: 1,
    };
    const result = await dispatchTemplateMessage({
      conversationId: "conv-5",
      phone: "+919811100001",
      templateName: "aarogya_medic_at_door",
      vars: { medic_first_name: "Sunita", medic_phone: "+919811112233" },
    });
    expect(result).toEqual({
      sent: false,
      blocked: false,
      error: "permanent_template_paused",
    });
  });

  it("session_expired path returns session_expired error string", async () => {
    h.sendResult = { ok: false, reason: "session_expired" };
    const result = await dispatchTemplateMessage({
      conversationId: "conv-6",
      phone: "+919811100001",
      templateName: "aarogya_medic_departed",
      vars: { medic_first_name: "Sunita" },
    });
    expect(result).toEqual({ sent: false, blocked: false, error: "session_expired" });
  });

  it("aarogya_medic_at_door template requires medic_phone — registry enforces", async () => {
    // The renderTemplate inside sendHardenedTemplate throws on missing vars, but
    // dispatchTemplateMessage doesn't pre-validate (the registry is the
    // enforcement point). Confirm we DON'T short-circuit on this — sendHardenedTemplate
    // is reached and the registry would do the throw at render time.
    h.sendResult = { ok: true, providerMessageId: "wamid-door", attemptsUsed: 1 };
    const result = await dispatchTemplateMessage({
      conversationId: "conv-7",
      phone: "+919811100001",
      templateName: "aarogya_medic_at_door",
      vars: { medic_first_name: "Sunita", medic_phone: "+919811112233" },
    });
    expect(result).toEqual({ sent: true, providerMessageId: "wamid-door" });
    expect(sendHardenedTemplate).toHaveBeenCalledTimes(1);
  });
});
