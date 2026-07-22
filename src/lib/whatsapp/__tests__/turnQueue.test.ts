// Aarogya turn queue — the serverless-safe debounce primitives.
//
// The coalescing + serialization themselves live in SQL (verified against the
// live DB in the PR); here we lock the TS surface: media never coalesces (own
// row), text does; media is due immediately (debounce 0); the env flag + window
// parse correctly; and the RPC wrappers pass the right args + fail safe.

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { rpc: (...a: unknown[]) => rpc(...a) },
}));
vi.mock("@/lib/whatsapp/log", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  maskPhone: (p: string) => p,
}));

import {
  DEFAULT_TURN_DEBOUNCE_MS,
  asyncProcessingEnabled,
  claimNextTurn,
  enqueueTurn,
  kindForInbound,
  turnDebounceMs,
} from "@/lib/whatsapp/turnQueue";

type Inbound = Parameters<typeof enqueueTurn>[0]["inbound"];
const inbound = (over: Partial<Inbound> = {}): Inbound =>
  ({
    providerMessageId: "wamid.1",
    phone: "+919812345678",
    type: "text",
    text: "hi",
    contactName: null,
    phoneNumberId: null,
    timestamp: "",
    buttonPayload: null,
    buttonText: null,
    contextId: null,
    raw: {},
    ...over,
  }) as Inbound;

beforeEach(() => rpc.mockReset());

describe("kindForInbound", () => {
  it("image + document are media (per-message, never coalesced)", () => {
    expect(kindForInbound(inbound({ type: "image" }))).toBe("media");
    expect(kindForInbound(inbound({ type: "document" }))).toBe("media");
  });
  it("text + location are text (coalescing)", () => {
    expect(kindForInbound(inbound({ type: "text" }))).toBe("text");
    expect(kindForInbound(inbound({ type: "location" }))).toBe("text");
  });
});

describe("turnDebounceMs", () => {
  it("defaults to 6000", () => {
    expect(turnDebounceMs({})).toBe(DEFAULT_TURN_DEBOUNCE_MS);
  });
  it("honours a valid override", () => {
    expect(turnDebounceMs({ AAROGYA_TURN_DEBOUNCE_MS: "2500" })).toBe(2500);
    expect(turnDebounceMs({ AAROGYA_TURN_DEBOUNCE_MS: "0" })).toBe(0);
  });
  it("falls back on garbage / negative", () => {
    expect(turnDebounceMs({ AAROGYA_TURN_DEBOUNCE_MS: "abc" })).toBe(DEFAULT_TURN_DEBOUNCE_MS);
    expect(turnDebounceMs({ AAROGYA_TURN_DEBOUNCE_MS: "-5" })).toBe(DEFAULT_TURN_DEBOUNCE_MS);
  });
});

describe("asyncProcessingEnabled", () => {
  it("only 'true' enables it (default off)", () => {
    expect(asyncProcessingEnabled({})).toBe(false);
    expect(asyncProcessingEnabled({ AAROGYA_ASYNC_PROCESSING: "false" })).toBe(false);
    expect(asyncProcessingEnabled({ AAROGYA_ASYNC_PROCESSING: "true" })).toBe(true);
  });
});

describe("enqueueTurn", () => {
  it("text turn enqueues with the debounce window", async () => {
    rpc.mockResolvedValue({ data: "turn-1", error: null });
    const id = await enqueueTurn({
      conversationId: "c1",
      messageId: "m1",
      inbound: inbound({ type: "text" }),
      debounceMs: 4000,
    });
    expect(id).toBe("turn-1");
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("enqueue_aarogya_turn");
    expect(args.p_kind).toBe("text");
    expect(args.p_debounce_ms).toBe(4000);
  });

  it("media turn is due immediately (debounce forced to 0)", async () => {
    rpc.mockResolvedValue({ data: "turn-2", error: null });
    await enqueueTurn({
      conversationId: "c1",
      messageId: "m2",
      inbound: inbound({ type: "image" }),
      debounceMs: 6000,
    });
    const [, args] = rpc.mock.calls[0];
    expect(args.p_kind).toBe("media");
    expect(args.p_debounce_ms).toBe(0);
  });

  it("returns null (never throws) on RPC error — reconcile will re-enqueue", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const id = await enqueueTurn({
      conversationId: "c1",
      messageId: "m3",
      inbound: inbound(),
    });
    expect(id).toBeNull();
  });
});

describe("claimNextTurn", () => {
  it("returns null when the RPC row is all-NULL (nothing due)", async () => {
    rpc.mockResolvedValue({ data: { id: null }, error: null });
    expect(await claimNextTurn()).toBeNull();
  });
  it("returns the row when one is claimed", async () => {
    rpc.mockResolvedValue({ data: { id: "turn-9", kind: "text" }, error: null });
    const row = await claimNextTurn();
    expect(row?.id).toBe("turn-9");
  });
  it("unwraps a single-element array result shape", async () => {
    rpc.mockResolvedValue({ data: [{ id: "turn-10" }], error: null });
    expect((await claimNextTurn())?.id).toBe("turn-10");
  });
});
