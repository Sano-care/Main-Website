// Aarogya chat-set medication reminder — executor (identity gate, flag gating,
// dedup, audit, confirmation) + frequency label helper.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { executeLogMedication } from "@/lib/whatsapp/pulseExecutors";
import { frequencyLabelForCount } from "@/app/api/pulse/_lib/createMedication";
import type { Identity } from "@/lib/whatsapp/identity";

const registered: Identity = { role: "customer", subRole: "registered", customerId: "cus-1" };
const carehub: Identity = { role: "customer", subRole: "carehub", customerId: "cus-2" };
const newcomer: Identity = { role: "new" };

type AnyMock = ReturnType<typeof vi.fn>;
const firstArg = (fn: AnyMock) => (fn.mock.calls[0] as unknown[])[0];

function baseDeps(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    now: new Date("2026-06-26T08:00:00+05:30"),
    createFn: vi.fn(async () => ({ medication: { id: "med-1" }, intakeCount: 14, error: null })),
    findActiveFn: vi.fn(async () => null),
    updateFn: vi.fn(async () => ({ ok: true })),
    writeAuditFn: vi.fn(async () => true),
    ...over,
  };
}

const call = (input: Record<string, unknown>, identity: Identity, deps: object) =>
  executeLogMedication({ identity, conversationId: "conv-1", input, deps } as never);

describe("executeLogMedication", () => {
  it("flag ON, new med → createMedication with the right row + MEDICATION_LOGGED + warm confirm", async () => {
    const deps = baseDeps();
    const out = await call(
      { name: "Shelcal", scheduled_times: ["20:40", "23:00"] },
      registered,
      deps,
    );

    expect((deps.createFn as AnyMock)).toHaveBeenCalledTimes(1);
    expect(firstArg(deps.createFn as AnyMock)).toMatchObject({
      customerId: "cus-1",
      name: "Shelcal",
      scheduledTimes: ["20:40", "23:00"],
      timesPerDay: 2,
      frequencyLabel: "Twice daily",
      dose: "as directed", // D1 default when not stated
      startDate: "2026-06-26",
      endDate: null,
      source: "aarogya_whatsapp",
    });
    expect((deps.writeAuditFn as AnyMock)).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "medication_logged",
        eventData: expect.objectContaining({ times_per_day: 2, updated: false }),
      }),
    );
    expect(out).toContain("Shelcal");
    expect(out).toContain("8:40 PM");
    expect(out).toContain("11:00 PM");
  });

  it("two medicines = two calls → two distinct rows", async () => {
    const deps = baseDeps();
    await call({ name: "Shelcal", scheduled_times: ["20:40"] }, registered, deps);
    await call({ name: "Faa", scheduled_times: ["23:00"] }, registered, deps);
    expect((deps.createFn as AnyMock)).toHaveBeenCalledTimes(2);
    expect((deps.createFn as AnyMock).mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual([
      "Shelcal",
      "Faa",
    ]);
  });

  it("same med again → updates the existing reminder, never duplicates", async () => {
    const deps = baseDeps({
      findActiveFn: vi.fn(async () => ({ id: "med-9", name: "shelcal" })),
    });
    const out = await call({ name: "Shelcal", scheduled_times: ["09:00"] }, registered, deps);

    expect((deps.updateFn as AnyMock)).toHaveBeenCalledWith(
      "med-9",
      expect.objectContaining({ scheduledTimes: ["09:00"], timesPerDay: 1, frequencyLabel: "Daily" }),
    );
    expect((deps.createFn as AnyMock)).not.toHaveBeenCalled();
    expect((deps.writeAuditFn as AnyMock)).toHaveBeenCalledWith(
      expect.objectContaining({ eventData: expect.objectContaining({ updated: true }) }),
    );
    expect(out).toMatch(/Updated/);
  });

  it("dose stated → passed through instead of the default", async () => {
    const deps = baseDeps();
    await call({ name: "Shelcal", scheduled_times: ["20:40"], dose: "1 tablet" }, registered, deps);
    expect(firstArg(deps.createFn as AnyMock)).toMatchObject({ dose: "1 tablet" });
  });

  it("flag OFF → no write, points to Pulse, NEVER Google Assistant", async () => {
    const deps = baseDeps({ enabled: false });
    const out = await call({ name: "Shelcal", scheduled_times: ["20:40"] }, registered, deps);
    expect((deps.createFn as AnyMock)).not.toHaveBeenCalled();
    expect((deps.writeAuditFn as AnyMock)).not.toHaveBeenCalled();
    expect(out).toMatch(/Pulse/);
    expect(out).not.toMatch(/google/i);
  });

  it("new sender (no customerId) → guided to set up, never an unscoped write", async () => {
    const deps = baseDeps();
    const out = await call({ name: "Shelcal", scheduled_times: ["20:40"] }, newcomer, deps);
    expect((deps.createFn as AnyMock)).not.toHaveBeenCalled();
    expect(out).toMatch(/Sanocare account/i);
  });

  it("missing time → asks one short question, no write", async () => {
    const deps = baseDeps();
    const out = await call({ name: "Shelcal", scheduled_times: [] }, registered, deps);
    expect((deps.createFn as AnyMock)).not.toHaveBeenCalled();
    expect(out).toMatch(/what time/i);
  });

  it("carehub customer can also set reminders", async () => {
    const deps = baseDeps();
    await call({ name: "Faa", scheduled_times: ["08:00"] }, carehub, deps);
    expect(firstArg(deps.createFn as AnyMock)).toMatchObject({ customerId: "cus-2", name: "Faa" });
  });
});

describe("frequencyLabelForCount", () => {
  it("maps dose counts to human labels", () => {
    expect(frequencyLabelForCount(1)).toBe("Daily");
    expect(frequencyLabelForCount(2)).toBe("Twice daily");
    expect(frequencyLabelForCount(3)).toBe("Three times daily");
    expect(frequencyLabelForCount(5)).toBe("5 times daily");
  });
});
