import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── External boundaries mocked; pure logic (classify, retry math, key, render)
//    runs for real. ────────────────────────────────────────────────────────

const auditEvents: Array<{ type: string; data: Record<string, unknown> }> = [];

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => ({
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}));

vi.mock("@/lib/whatsapp/safety/audit", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    writeAudit: vi.fn(async (e: { eventType: string; eventData?: Record<string, unknown> }) => {
      auditEvents.push({ type: e.eventType, data: e.eventData ?? {} });
      return true;
    }),
  };
});

vi.mock("@/lib/whatsapp/session", () => ({
  SESSION_WINDOW_MS: 24 * 60 * 60 * 1000,
  getSessionWindow: vi.fn(async () => ({
    open: true,
    lastUserMsgAt: new Date().toISOString(),
    ageMs: 1000,
  })),
}));

vi.mock("@/lib/whatsapp/idempotency", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual, // keep the real computeIdempotencyKey
    findRecentByIdempotencyKey: vi.fn(async () => null),
  };
});

vi.mock("@/lib/whatsapp/cloud-api", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, sendTextMessage: vi.fn(), sendTemplateMessage: vi.fn() };
});

import { CloudApiError, sendTextMessage } from "@/lib/whatsapp/cloud-api";
import {
  classifySendError,
  PermanentSendError,
  RateLimitedError,
  TransientSendError,
} from "@/lib/whatsapp/errors";
import { withBackoff } from "@/lib/whatsapp/retry";
import { computeIdempotencyKey } from "@/lib/whatsapp/idempotency";
import { renderTemplate } from "@/lib/whatsapp/templates";
import { findRecentByIdempotencyKey } from "@/lib/whatsapp/idempotency";
import { getSessionWindow } from "@/lib/whatsapp/session";
import { sendHardenedText, sendHardenedTemplate } from "@/lib/whatsapp/sender";

const mockSendText = vi.mocked(sendTextMessage);
const mockFindDup = vi.mocked(findRecentByIdempotencyKey);
const mockSession = vi.mocked(getSessionWindow);

// Deterministic backoff: no real waits, fixed jitter, frozen clock.
const fastBackoff = { sleep: async () => {}, random: () => 0.5, now: () => 0 };

beforeEach(() => {
  auditEvents.length = 0;
  mockSendText.mockReset();
  mockFindDup.mockReset();
  mockFindDup.mockResolvedValue(null);
  mockSession.mockReset();
  mockSession.mockResolvedValue({ open: true, lastUserMsgAt: "now", ageMs: 1000 });
});

afterEach(() => vi.clearAllMocks());

function typesOf() {
  return auditEvents.map((e) => e.type);
}

// ── 1. Error classification ────────────────────────────────────────────────

describe("classifySendError", () => {
  it("permanent: 400/401/403/404", () => {
    for (const status of [400, 401, 403, 404]) {
      expect(classifySendError({ status })).toBeInstanceOf(PermanentSendError);
    }
  });
  it("permanent: Meta auth code 190 + 131xx/132xxx/133xxx families", () => {
    expect(classifySendError({ status: 200, code: 190 })).toBeInstanceOf(PermanentSendError);
    expect(classifySendError({ status: 200, code: 13146 })).toBeInstanceOf(PermanentSendError);
    expect(classifySendError({ status: 200, code: 132000 })).toBeInstanceOf(PermanentSendError);
    expect(classifySendError({ status: 200, code: 133010 })).toBeInstanceOf(PermanentSendError);
  });
  it("permanent: subcodes 33 + 2494007", () => {
    expect(classifySendError({ status: 500, subcode: 33 })).toBeInstanceOf(PermanentSendError);
    expect(classifySendError({ status: 503, subcode: 2494007 })).toBeInstanceOf(PermanentSendError);
  });
  it("transient: 408/500-504/524 + Meta codes 1/2/4", () => {
    for (const status of [408, 500, 502, 503, 504, 524]) {
      expect(classifySendError({ status })).toBeInstanceOf(TransientSendError);
    }
    expect(classifySendError({ status: 200, code: 4 })).toBeInstanceOf(TransientSendError);
  });
  it("429 → RateLimitedError carrying retryAfter", () => {
    const e = classifySendError({ status: 429, retryAfter: 7 });
    expect(e).toBeInstanceOf(RateLimitedError);
    expect((e as RateLimitedError).retryAfter).toBe(7);
  });
  it("network error → transient", () => {
    expect(classifySendError({ network: true })).toBeInstanceOf(TransientSendError);
  });
  it("unknown → permanent (fail loud)", () => {
    expect(classifySendError({ status: 418 })).toBeInstanceOf(PermanentSendError);
    expect(classifySendError({})).toBeInstanceOf(PermanentSendError);
  });
});

// ── 2. Retry math ──────────────────────────────────────────────────────────

describe("withBackoff", () => {
  it("permanent error → 1 attempt, no retry", async () => {
    const fn = vi.fn(async () => {
      throw new PermanentSendError("nope");
    });
    await expect(withBackoff(fn, fastBackoff)).rejects.toBeInstanceOf(PermanentSendError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("transient then success → returns result + attempts", async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      n += 1;
      if (n < 3) throw new TransientSendError("retry me");
      return "ok";
    });
    const { result, attempts } = await withBackoff(fn, fastBackoff);
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("exhausts maxAttempts then throws the transient error", async () => {
    const fn = vi.fn(async () => {
      throw new TransientSendError("always down");
    });
    await expect(withBackoff(fn, { ...fastBackoff, maxAttempts: 3 })).rejects.toBeInstanceOf(
      TransientSendError,
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("computes exponential delay with seeded jitter (random=0.5 → +25% of base)", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const fn = async () => {
      n += 1;
      if (n < 3) throw new TransientSendError("x");
      return "ok";
    };
    // random()=>1 → jitterOffset = +jitter*exp. base=1000, jitter=0.25.
    // attempt1 delay = 1000 + 1000*0.25*(1) = 1250; attempt2 = 2000 + 500 = 2500.
    await withBackoff(fn, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 1,
      now: () => 0,
      baseMs: 1000,
      jitter: 0.25,
    });
    expect(sleeps).toEqual([1250, 2500]);
  });

  it("aborts when the next wait would exceed the wall-clock budget", async () => {
    let t = 0;
    const fn = vi.fn(async () => {
      throw new TransientSendError("down");
    });
    // clock jumps 9s per call; budget 10s → second wait (≥1s) would exceed → abort after 1 attempt's wait.
    await expect(
      withBackoff(fn, {
        sleep: async () => {},
        random: () => 0.5,
        now: () => {
          const v = t;
          t += 9000;
          return v;
        },
        budgetMs: 10_000,
      }),
    ).rejects.toBeInstanceOf(TransientSendError);
  });
});

// ── 3. Idempotency key ─────────────────────────────────────────────────────

describe("computeIdempotencyKey", () => {
  it("is deterministic within a minute bucket and varies across content/convo/minute", () => {
    const a = computeIdempotencyKey("c1", "hello", 60_000);
    const b = computeIdempotencyKey("c1", "hello", 60_000 + 59_000); // same bucket
    const c = computeIdempotencyKey("c1", "hello", 120_000); // next bucket
    const d = computeIdempotencyKey("c1", "world", 60_000);
    const e = computeIdempotencyKey("c2", "hello", 60_000);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a).not.toBe(e);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ── 4. Template rendering ──────────────────────────────────────────────────

describe("renderTemplate", () => {
  it("substitutes body vars in declared order", () => {
    const r = renderTemplate("aarogya_booking_reminder_v1", { date: "June 18", time: "5 PM" });
    expect(r.templateName).toBe("aarogya_booking_reminder_v1");
    expect(r.bodyParams).toEqual(["June 18", "5 PM"]);
    expect(r.varsHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("attaches quick-reply payload only for templates that declare buttons", () => {
    const re = renderTemplate("aarogya_reengagement_v1", { first_name: "Asha", service_label: "Home Visit" }, { quickReplyPayload: "esc-1" });
    expect(re.quickReplyPayload).toBe("esc-1");
    const rem = renderTemplate("aarogya_booking_reminder_v1", { date: "x", time: "y" }, { quickReplyPayload: "esc-1" });
    expect(rem.quickReplyPayload).toBeUndefined();
  });
  it("throws on a missing required var", () => {
    expect(() => renderTemplate("aarogya_booking_reminder_v1", { date: "June 18" })).toThrow(/missing required var "time"/);
  });
});

// ── 5/6. Integration: sender happy + sad paths ─────────────────────────────

const BASE = { conversationId: "conv-1", phone: "919812345678", body: "hi there" };

describe("sendHardenedText", () => {
  it("AC1 — permanent (403): 1 attempt, permanent failure logged, no retry", async () => {
    mockSendText.mockRejectedValue(new CloudApiError("forbidden", 403));
    const res = await sendHardenedText({ ...BASE, clock: () => 0, backoff: fastBackoff });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("permanent");
    expect(mockSendText).toHaveBeenCalledTimes(1);
    expect(typesOf()).toContain("outbound_send_failed_permanent");
    expect(typesOf()).not.toContain("outbound_send_failed_transient");
    expect(typesOf().filter((t) => t === "outbound_send_attempted")).toHaveLength(1);
  });

  it("AC2a — 2 transient then success on 3rd: outbound_sent with attempts_used=3", async () => {
    let n = 0;
    mockSendText.mockImplementation(async () => {
      n += 1;
      if (n < 3) throw new CloudApiError("temporarily down", 503);
      return { providerMessageId: "wamid.success" };
    });
    const res = await sendHardenedText({ ...BASE, clock: () => 0, backoff: fastBackoff });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.providerMessageId).toBe("wamid.success");
      expect(res.attemptsUsed).toBe(3);
    }
    expect(mockSendText).toHaveBeenCalledTimes(3);
    const sent = auditEvents.find((e) => e.type === "outbound_sent");
    expect(sent?.data.attempts_used).toBe(3);
    expect(typesOf().filter((t) => t === "outbound_send_failed_transient")).toHaveLength(2);
  });

  it("AC2b — all 3 transient fail: 3x transient + final permanent, no outbound_sent", async () => {
    mockSendText.mockRejectedValue(new CloudApiError("down", 503));
    const res = await sendHardenedText({ ...BASE, clock: () => 0, backoff: fastBackoff });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("transient_exhausted");
    expect(mockSendText).toHaveBeenCalledTimes(3);
    expect(typesOf().filter((t) => t === "outbound_send_failed_transient")).toHaveLength(3);
    expect(typesOf().filter((t) => t === "outbound_send_failed_permanent")).toHaveLength(1);
    expect(typesOf()).not.toContain("outbound_sent");
  });

  it("AC3 — idempotent: same-minute duplicate is a no-op returning the first wamid", async () => {
    mockFindDup.mockResolvedValue({ providerMessageId: "wamid.first", createdAt: "t" });
    const res = await sendHardenedText({ ...BASE, clock: () => 0, backoff: fastBackoff });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.deduped).toBe(true);
      expect(res.providerMessageId).toBe("wamid.first");
    }
    expect(mockSendText).not.toHaveBeenCalled();
  });

  it("AC4 — session expired: outbound_session_expired, send rejected, no Meta call", async () => {
    mockSession.mockResolvedValue({ open: false, lastUserMsgAt: "old", ageMs: 90_000_000 });
    const res = await sendHardenedText({ ...BASE, clock: () => 0, backoff: fastBackoff });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("session_expired");
    expect(mockSendText).not.toHaveBeenCalled();
    expect(typesOf()).toContain("outbound_session_expired");
  });

  it("happy path — first-attempt success: outbound_sent attempts_used=1", async () => {
    mockSendText.mockResolvedValue({ providerMessageId: "wamid.1" });
    const res = await sendHardenedText({ ...BASE, clock: () => 0, backoff: fastBackoff });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.attemptsUsed).toBe(1);
    const sent = auditEvents.find((e) => e.type === "outbound_sent");
    expect(sent?.data.wamid).toBe("wamid.1");
  });
});

describe("sendHardenedTemplate", () => {
  it("renders + sends a template and logs outbound_template_sent with vars_hash (no session check)", async () => {
    const { sendTemplateMessage } = await import("@/lib/whatsapp/cloud-api");
    vi.mocked(sendTemplateMessage).mockResolvedValue({ providerMessageId: "wamid.tmpl" });
    mockSession.mockResolvedValue({ open: false, lastUserMsgAt: "old", ageMs: 99_000_000 }); // window closed, still sends
    const res = await sendHardenedTemplate({
      conversationId: "conv-1",
      phone: "919812345678",
      templateName: "aarogya_booking_reminder_v1",
      vars: { date: "June 18", time: "5 PM" },
      clock: () => 0,
      backoff: fastBackoff,
    });
    expect(res.ok).toBe(true);
    const evt = auditEvents.find((e) => e.type === "outbound_template_sent");
    expect(evt?.data.template_name).toBe("aarogya_booking_reminder_v1");
    expect(evt?.data.vars_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(evt?.data).not.toHaveProperty("date"); // raw vars never audited
  });
});
