// Aarogya chat-set medication reminder — executor (identity gate, flag gating,
// dedup, audit, confirmation) + frequency label helper.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { executeLogMedication } from "@/lib/whatsapp/pulseExecutors";
import {
  frequencyLabelForCount,
  ALLOWED_MEDICATION_SOURCES,
  AAROGYA_MEDICATION_SOURCE,
} from "@/app/api/pulse/_lib/createMedication";
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

// The live bug: from FOUNDER_OPS_PHONE, "remind me to take Telma 40 at 10am"
// returned an external-app suggestion because ops_founder never got
// log_medication. The founder IS a customer, so resolve their id by phone.
describe("executeLogMedication — ops_founder (the founder is also a customer)", () => {
  const opsFounder: Identity = { role: "ops_founder", phone: "+919760059900" };

  it("flag ON → resolves the founder's customer_id by phone, logs the med, never an external app", async () => {
    const resolveCustomerIdFn = vi.fn(async () => "cus-founder");
    const deps = baseDeps({ resolveCustomerIdFn });
    const out = await call({ name: "Telma 40", scheduled_times: ["10:00"] }, opsFounder, deps);

    expect(resolveCustomerIdFn).toHaveBeenCalledWith("+919760059900");
    expect(firstArg(deps.createFn as AnyMock)).toMatchObject({
      customerId: "cus-founder",
      name: "Telma 40",
      scheduledTimes: ["10:00"],
    });
    expect(out).toContain("Telma 40");
    expect(out).toContain("10:00 AM");
    expect(out).not.toMatch(/google|calendar|assistant|alarm/i);
  });

  it("flag OFF → captures + points to Pulse, no write, never an external app", async () => {
    const deps = baseDeps({ enabled: false, resolveCustomerIdFn: vi.fn(async () => "cus-founder") });
    const out = await call({ name: "Telma 40", scheduled_times: ["10:00"] }, opsFounder, deps);
    expect((deps.createFn as AnyMock)).not.toHaveBeenCalled();
    expect(out).toMatch(/Pulse/);
    expect(out).not.toMatch(/google|calendar|assistant|alarm/i);
  });

  it("founder somehow has no customer row → graceful refusal, no write", async () => {
    const deps = baseDeps({ resolveCustomerIdFn: vi.fn(async () => null) });
    const out = await call({ name: "Telma 40", scheduled_times: ["10:00"] }, opsFounder, deps);
    expect((deps.createFn as AnyMock)).not.toHaveBeenCalled();
    expect(out).toMatch(/Sanocare account/i);
  });
});

// Drift guard for the prod hotfix (migration 20260627034703): the source the
// executor writes MUST be in the allow-list that mirrors medications_source_check.
// The original bug — 'aarogya_whatsapp' written while the constraint allowed only
// 'manual'/'rx_import' — slipped through because the tests mock supabaseAdmin and
// never hit the real CHECK. This ties the executor's written value to the list.
describe("medications.source ↔ medications_source_check (drift guard)", () => {
  it("allow-list mirrors the live CHECK constraint (manual / rx_import / aarogya_whatsapp)", () => {
    expect([...ALLOWED_MEDICATION_SOURCES].sort()).toEqual(
      ["aarogya_whatsapp", "manual", "rx_import"].sort(),
    );
  });

  it("the Aarogya source constant is a member of the allow-list", () => {
    expect(ALLOWED_MEDICATION_SOURCES).toContain(AAROGYA_MEDICATION_SOURCE);
  });

  it("the value executeLogMedication actually writes is an allowed source", async () => {
    const deps = baseDeps();
    await call({ name: "Telma 40", scheduled_times: ["10:00"] }, registered, deps);
    const written = (firstArg(deps.createFn as AnyMock) as { source: string }).source;
    expect(written).toBe(AAROGYA_MEDICATION_SOURCE);
    expect(ALLOWED_MEDICATION_SOURCES as readonly string[]).toContain(written);
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
