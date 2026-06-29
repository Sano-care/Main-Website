// The ops-relay persistence fix: a confirmed relay must land in the RECIPIENT's
// thread (it previously only sent + echoed in the ops thread), via the SAME
// outbound writer (persistOutbound), idempotent on the wamid.

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ existingMessage: null as { id: string } | null }));

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from(table: string) {
      if (table === "leads") {
        const c: Record<string, unknown> = {};
        c.upsert = () => c;
        c.select = () => c;
        c.single = async () => ({ data: { id: "lead-1" }, error: null });
        return c;
      }
      if (table === "conversations") {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.order = () => c;
        c.limit = () => c;
        c.maybeSingle = async () => ({
          data: { id: "recip-conv", whatsapp_phone: "x", lead_id: "lead-1", opt_out: false, state: "active" },
          error: null,
        });
        c.update = () => ({ eq: async () => ({ error: null }) });
        c.insert = () => c;
        return c;
      }
      if (table === "messages") {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.limit = () => c;
        c.maybeSingle = async () => ({ data: state.existingMessage, error: null });
        return c;
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

vi.mock("@/lib/whatsapp/sender", () => ({
  persistOutbound: vi.fn(async () => {}),
  sendHardenedText: vi.fn(),
  sendHardenedTemplate: vi.fn(),
}));
vi.mock("@/lib/whatsapp/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  maskPhone: (p: string) => p,
}));

import { persistRelayIntoRecipientThread } from "@/lib/whatsapp/db";
import { persistOutbound } from "@/lib/whatsapp/sender";

beforeEach(() => {
  state.existingMessage = null;
  vi.mocked(persistOutbound).mockClear();
});

describe("persistRelayIntoRecipientThread", () => {
  it("writes exactly one outbound row into the recipient thread (body + wamid + ops_relay marker)", async () => {
    await persistRelayIntoRecipientThread({
      targetPhone: "+918506863257",
      body: "Hi, your medic is 15 min away.",
      providerMessageId: "wamid.HBgM123",
      draftId: "draft-9",
    });

    expect(persistOutbound).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(persistOutbound).mock.calls[0][0];
    expect(arg).toMatchObject({
      conversationId: "recip-conv", // resolved by findOrCreateConversation(targetPhone)
      content: "Hi, your medic is 15 min away.",
      contentType: "text",
      providerMessageId: "wamid.HBgM123",
    });
    expect(arg.safetyFlags).toMatchObject({ ops_relay: true, topic: "ops_relay", draft_id: "draft-9" });
  });

  it("is idempotent — if the wamid is already in the recipient thread, no second write", async () => {
    state.existingMessage = { id: "existing-row" };
    await persistRelayIntoRecipientThread({
      targetPhone: "+918506863257",
      body: "x",
      providerMessageId: "wamid.dup",
      draftId: "draft-9",
    });
    expect(persistOutbound).not.toHaveBeenCalled();
  });
});
