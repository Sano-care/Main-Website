// Conversation-quality hotfix — the single hardened ops alert sender.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import {
  sendOpsAlert,
  OPS_ALERT_TARGET_DIGITS,
  OPS_ALERT_ALT_DIGITS,
} from "@/lib/whatsapp/opsAlert";

const baseArgs = {
  conversationId: "c1",
  escalationId: "e1",
  patientName: "Rajesh",
  patientAge: "45",
  serviceDisplay: "Home Visit",
  location: "Kalkaji",
  context: "fever",
  patientMobile: "+9199",
};

function deps(over: { fail?: number } = {}) {
  // fail = number of leading attempts that throw before one succeeds (Infinity = all fail)
  let calls = 0;
  const sends: Array<{ to: string; bodyParams: string[] }> = [];
  const audits: string[] = [];
  return {
    sends,
    audits,
    obj: {
      env: {} as Record<string, string | undefined>,
      sendTemplate: vi.fn(async (a: { to: string; bodyParams: string[] }) => {
        calls++;
        if (over.fail && calls <= over.fail) throw new Error("send failed");
        sends.push(a);
        return { providerMessageId: `wamid-${calls}` };
      }),
      writeAuditFn: vi.fn(async (e: { eventType: string }) => {
        audits.push(e.eventType);
        return true;
      }),
      setEscalationWamid: vi.fn(async () => {}),
    },
  };
}

beforeEach(() => {});

describe("sendOpsAlert", () => {
  it("targets the canonical ops line by default (no override)", async () => {
    const d = deps();
    const r = await sendOpsAlert(baseArgs, d.obj);
    expect(r.sent).toBe(true);
    expect(r.target).toBe(OPS_ALERT_TARGET_DIGITS); // 919711977782
    expect(d.audits).toContain("ops_alert_sent");
  });

  it("uses MY_PERSONAL_WHATSAPP override when set (digits)", async () => {
    const d = deps();
    d.obj.env = { MY_PERSONAL_WHATSAPP: "+918888777777" };
    const r = await sendOpsAlert(baseArgs, d.obj);
    expect(r.target).toBe("918888777777");
  });

  it("never sends blank vars — substitutes — / unknown", async () => {
    const d = deps();
    await sendOpsAlert(
      { ...baseArgs, patientName: "", patientAge: "  ", location: "", context: "", patientMobile: "" },
      d.obj,
    );
    expect(d.sends[0].bodyParams).toEqual(["unknown", "—", "Home Visit", "—", "—", "unknown"]);
  });

  it("retries once on primary, then succeeds", async () => {
    const d = deps({ fail: 1 }); // first attempt throws, second (retry) succeeds
    const r = await sendOpsAlert(baseArgs, d.obj);
    expect(r.sent).toBe(true);
    expect(r.attempts).toBe(2);
    expect(r.target).toBe(OPS_ALERT_TARGET_DIGITS); // still primary, on retry
  });

  it("falls back to the alternate number when the primary keeps failing", async () => {
    const d = deps({ fail: 2 }); // primary + retry throw; alternate (3rd) succeeds
    const r = await sendOpsAlert(baseArgs, d.obj);
    expect(r.sent).toBe(true);
    expect(r.attempts).toBe(3);
    expect(r.target).toBe(OPS_ALERT_ALT_DIGITS); // 919760059900
  });

  it("LOUD failure: all attempts fail → ops_alert_failed audit, never throws", async () => {
    const d = deps({ fail: 99 });
    const r = await sendOpsAlert(baseArgs, d.obj);
    expect(r.sent).toBe(false);
    expect(r.attempts).toBe(3);
    expect(d.audits).toContain("ops_alert_failed");
    expect(d.audits).not.toContain("ops_alert_sent");
  });
});
