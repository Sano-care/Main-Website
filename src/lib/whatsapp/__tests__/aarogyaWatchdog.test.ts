// Aarogya watchdogs — reconciliation + escalation re-alert. Dependency-injected,
// so no Supabase / BSP. Covers: stuck-turn requeue, lost-turn re-enqueue,
// 2h ops alert, and the daily escalation re-alert.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { rpc: vi.fn() } }));
vi.mock("@/lib/whatsapp/opsAlert", () => ({
  sendOpsAlert: vi.fn(async () => ({ sent: true, attempts: 1 })),
  OPS_ALERT_TARGET_DIGITS: "919760059900",
}));
vi.mock("@/lib/whatsapp/turnQueue", () => ({
  enqueueTurn: vi.fn(async () => "turn-x"),
  requeueStuckTurns: vi.fn(async () => 0),
}));
vi.mock("@/lib/whatsapp/log", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  maskPhone: (p: string) => p,
}));

import {
  runEscalationWatchdog,
  runReconcileWatchdog,
  type ReconcileCandidate,
  type ReconcileDeps,
} from "@/lib/whatsapp/aarogyaWatchdog";
import type { OpsAlertArgs } from "@/lib/whatsapp/opsAlert";

const okAlert = () =>
  vi.fn<(args: OpsAlertArgs) => Promise<{ sent: boolean; attempts: number }>>(
    async () => ({ sent: true, attempts: 1 }),
  );

const candidate = (over: Partial<ReconcileCandidate> = {}): ReconcileCandidate => ({
  conversation_id: "conv-1",
  phone: "+919812345678",
  message_id: "msg-1",
  content: "Harsh Anand",
  content_type: "text",
  raw_payload: { id: "wamid.1", text: { body: "Harsh Anand" } },
  provider_message_id: "wamid.1",
  ...over,
});

describe("runReconcileWatchdog", () => {
  it("requeues stuck turns, re-enqueues lost turns, and alerts on 2h stale", async () => {
    const enqueue = vi.fn<ReconcileDeps["enqueue"]>(async () => "turn-1");
    const sendOpsAlertFn = okAlert();
    const r = await runReconcileWatchdog({
      requeueStuck: vi.fn(async () => 3),
      getCandidates: vi.fn(async () => [candidate(), candidate({ conversation_id: "conv-2" })]),
      getStale: vi.fn(async () => [
        { conversation_id: "conv-9", phone: "+919800000000", last_user_msg_at: "2026-07-22T00:00:00Z" },
      ]),
      enqueue,
      sendOpsAlertFn,
    });

    expect(r.requeuedStuck).toBe(3);
    expect(r.reEnqueued).toBe(2);
    expect(r.opsAlerted).toBe(1);
    // The re-enqueue rebuilds the inbound from the persisted message + is due now.
    const firstCall = enqueue.mock.calls[0][0];
    expect(firstCall.conversationId).toBe("conv-1");
    expect(firstCall.debounceMs).toBe(0);
    expect(firstCall.inbound.text).toBe("Harsh Anand"); // the dropped name reply, rebuilt
    expect(firstCall.inbound.type).toBe("text");
    // The 2h alert routes to ops (never the WABA).
    expect(sendOpsAlertFn).toHaveBeenCalledTimes(1);
    expect(sendOpsAlertFn.mock.calls[0][0].patientMobile).toBe("+919800000000");
  });

  it("no candidates / no stale → no enqueue, no alert", async () => {
    const enqueue = vi.fn();
    const sendOpsAlertFn = okAlert();
    const r = await runReconcileWatchdog({
      requeueStuck: vi.fn(async () => 0),
      getCandidates: vi.fn(async () => []),
      getStale: vi.fn(async () => []),
      enqueue,
      sendOpsAlertFn,
    });
    expect(r).toEqual({ requeuedStuck: 0, reEnqueued: 0, opsAlerted: 0 });
    expect(enqueue).not.toHaveBeenCalled();
    expect(sendOpsAlertFn).not.toHaveBeenCalled();
  });

  it("a failed enqueue is not counted (message stays for the next run)", async () => {
    const r = await runReconcileWatchdog({
      requeueStuck: vi.fn(async () => 0),
      getCandidates: vi.fn(async () => [candidate()]),
      getStale: vi.fn(async () => []),
      enqueue: vi.fn(async () => null), // enqueue failed
      sendOpsAlertFn: okAlert(),
    });
    expect(r.reEnqueued).toBe(0);
  });
});

describe("runEscalationWatchdog", () => {
  it("re-alerts each escalation stuck >24h", async () => {
    const sendOpsAlertFn = okAlert();
    const r = await runEscalationWatchdog({
      getStuck: vi.fn(async () => [
        { conversation_id: "c1", phone: "+919811111111", updated_at: "2026-07-20T00:00:00Z" },
        { conversation_id: "c2", phone: "+919822222222", updated_at: "2026-07-20T01:00:00Z" },
      ]),
      sendOpsAlertFn,
    });
    expect(r.found).toBe(2);
    expect(r.alerted).toBe(2);
    expect(sendOpsAlertFn).toHaveBeenCalledTimes(2);
    expect(sendOpsAlertFn.mock.calls[0][0].patientName).toContain("ESCALATION");
  });

  it("nothing stuck → no alert", async () => {
    const sendOpsAlertFn = okAlert();
    const r = await runEscalationWatchdog({
      getStuck: vi.fn(async () => []),
      sendOpsAlertFn,
    });
    expect(r).toEqual({ found: 0, alerted: 0 });
    expect(sendOpsAlertFn).not.toHaveBeenCalled();
  });
});
