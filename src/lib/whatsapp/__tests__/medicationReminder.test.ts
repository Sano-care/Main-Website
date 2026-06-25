// Aarogya medication reminder sweep — due-window, quiet hours, dedupe, IST.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/whatsapp/cloud-api", () => ({ sendTemplateMessage: vi.fn() }));
vi.mock("@/lib/whatsapp/carehubOutbound", () => ({
  firstNameOrFallback: (n: string | null | undefined) =>
    (n ?? "there").trim().split(/\s+/)[0],
}));
vi.mock("@/lib/whatsapp/log", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import {
  runMedicationReminderSweep,
  withinQuietHours,
  isMedicationReminderEnabled,
  MEDICATION_REMINDER_TEMPLATE,
} from "@/lib/whatsapp/medicationReminder";
import { istWallTimeToUtc } from "@/app/api/pulse/_lib/ist";
import { AuditEvent } from "@/lib/whatsapp/safety/audit";

type Med = {
  id: string;
  customer_id: string;
  name: string;
  dose: string;
  scheduled_times: unknown;
};

function fakeSupabase(cfg: {
  meds?: Med[];
  medsError?: { message: string } | null;
  customer?: { phone: string | null; full_name: string | null } | null;
  claim?: { data: { id: string } | null; error: { code?: string } | null };
}) {
  const captured: { lte?: [string, unknown]; or?: string } = {};
  const calls = { inserts: [] as unknown[], deletes: [] as unknown[] };
  const client = {
    from(table: string) {
      if (table === "medications") {
        const chain = {
          select: () => chain,
          lte: (c: string, v: unknown) => {
            captured.lte = [c, v];
            return chain;
          },
          or: (a: string) => {
            captured.or = a;
            return chain;
          },
          limit: async () => ({ data: cfg.meds ?? [], error: cfg.medsError ?? null }),
        };
        return chain;
      }
      if (table === "customers") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: cfg.customer ?? null, error: null }),
        };
        return chain;
      }
      if (table === "medication_reminder_log") {
        const chain = {
          insert: (row: unknown) => {
            calls.inserts.push(row);
            return chain;
          },
          select: () => chain,
          maybeSingle: async () => cfg.claim ?? { data: { id: "log1" }, error: null },
          delete: () => chain,
          eq: (_c: string, v: unknown) => {
            calls.deletes.push(v);
            return Promise.resolve({ data: null, error: null });
          },
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client: client as never, captured, calls };
}

const med = (over: Partial<Med> = {}): Med => ({
  id: "m1",
  customer_id: "c1",
  name: "Metformin",
  dose: "1 tablet",
  scheduled_times: ["08:00"],
  ...over,
});
const customer = { phone: "+919990001111", full_name: "Ravi Kumar" };
const DUE_NOW = new Date("2026-06-25T08:05:00+05:30"); // inside [08:00, 08:15) IST

const reasonsOf = (audit: ReturnType<typeof vi.fn>) =>
  audit.mock.calls.map(
    (c) => (c[0] as { eventData?: { reason?: string } }).eventData?.reason,
  );
const eventsOf = (audit: ReturnType<typeof vi.fn>) =>
  audit.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);

describe("runMedicationReminderSweep", () => {
  it("due dose + flag ON → one send [name,medicine,dose] + one log row + SENT audit", async () => {
    const { client, calls } = fakeSupabase({ meds: [med()], customer });
    const send = vi.fn(async () => ({ providerMessageId: "wamid-1" }));
    const audit = vi.fn(async () => {});
    const res = await runMedicationReminderSweep({
      supabase: client,
      sendTemplate: send as never,
      writeAuditFn: audit as never,
      enabled: true,
      now: DUE_NOW,
    });
    expect(res.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      to: "+919990001111",
      templateName: MEDICATION_REMINDER_TEMPLATE,
      bodyParams: ["Ravi", "Metformin", "1 tablet"],
    });
    expect(calls.inserts).toHaveLength(1);
    expect(eventsOf(audit)).toContain(AuditEvent.MEDICATION_REMINDER_SENT);
  });

  it("same dose, second run same window → no second send (ON CONFLICT 23505)", async () => {
    const { client } = fakeSupabase({
      meds: [med()],
      customer,
      claim: { data: null, error: { code: "23505" } },
    });
    const send = vi.fn(async () => ({ providerMessageId: "x" }));
    const res = await runMedicationReminderSweep({
      supabase: client,
      sendTemplate: send as never,
      writeAuditFn: vi.fn() as never,
      enabled: true,
      now: DUE_NOW,
    });
    expect(res.sent).toBe(0);
    expect(res.skippedAlreadySent).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("dose outside 07:00–22:00 IST → skipped (quiet_hours), no send/claim", async () => {
    const { client, calls } = fakeSupabase({
      meds: [med({ scheduled_times: ["23:00"] })],
      customer,
    });
    const send = vi.fn();
    const audit = vi.fn(async () => {});
    const res = await runMedicationReminderSweep({
      supabase: client,
      sendTemplate: send as never,
      writeAuditFn: audit as never,
      enabled: true,
      now: new Date("2026-06-25T23:05:00+05:30"),
    });
    expect(res.skippedQuietHours).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(calls.inserts).toHaveLength(0);
    expect(reasonsOf(audit)).toContain("quiet_hours");
  });

  it("query filters to active meds (start_date ≤ today, end_date null or ≥ today)", async () => {
    const { client, captured } = fakeSupabase({ meds: [], customer });
    await runMedicationReminderSweep({
      supabase: client,
      sendTemplate: vi.fn() as never,
      writeAuditFn: vi.fn() as never,
      enabled: true,
      now: DUE_NOW,
    });
    expect(captured.lte).toEqual(["start_date", "2026-06-25"]);
    expect(captured.or).toBe("end_date.is.null,end_date.gte.2026-06-25");
  });

  it("flag OFF → no sends, audits flag_off, never reads meds", async () => {
    const { client, calls } = fakeSupabase({ meds: [med()], customer });
    const send = vi.fn();
    const audit = vi.fn(async () => {});
    const res = await runMedicationReminderSweep({
      supabase: client,
      sendTemplate: send as never,
      writeAuditFn: audit as never,
      enabled: false,
      now: DUE_NOW,
    });
    expect(res.ran).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(calls.inserts).toHaveLength(0);
    expect(reasonsOf(audit)).toEqual(["flag_off"]);
  });

  it("missing customers.phone → skip + audit no_phone, no claim, no crash", async () => {
    const { client, calls } = fakeSupabase({
      meds: [med()],
      customer: { phone: null, full_name: "X" },
    });
    const send = vi.fn();
    const audit = vi.fn(async () => {});
    const res = await runMedicationReminderSweep({
      supabase: client,
      sendTemplate: send as never,
      writeAuditFn: audit as never,
      enabled: true,
      now: DUE_NOW,
    });
    expect(res.skippedNoPhone).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(calls.inserts).toHaveLength(0);
    expect(reasonsOf(audit)).toContain("no_phone");
  });

  it("send failure → releases the claim (delete) + audits send_failed, sweep continues", async () => {
    const { client, calls } = fakeSupabase({ meds: [med()], customer });
    const send = vi.fn(async () => {
      throw new Error("graph 500");
    });
    const audit = vi.fn(async () => {});
    const res = await runMedicationReminderSweep({
      supabase: client,
      sendTemplate: send as never,
      writeAuditFn: audit as never,
      enabled: true,
      now: DUE_NOW,
    });
    expect(res.sent).toBe(0);
    expect(res.failed).toBe(1);
    expect(calls.inserts).toHaveLength(1); // claimed
    expect(calls.deletes).toHaveLength(1); // released
    expect(reasonsOf(audit)).toContain("send_failed");
  });

  it("a non-due dose in the same med is never sent (only the due window fires)", async () => {
    const { client } = fakeSupabase({
      meds: [med({ scheduled_times: ["08:00", "20:00"] })],
      customer,
    });
    const send = vi.fn(async () => ({ providerMessageId: "w" }));
    const res = await runMedicationReminderSweep({
      supabase: client,
      sendTemplate: send as never,
      writeAuditFn: vi.fn() as never,
      enabled: true,
      now: DUE_NOW, // only 08:00 is in window; 20:00 is hours away
    });
    expect(res.dueDoses).toBe(1);
    expect(res.sent).toBe(1);
  });
});

describe("IST→UTC conversion (date rollover) — reuses the meds scheduler's converter", () => {
  it("08:00 IST → 02:30 UTC same date; 02:00 IST → previous UTC day", () => {
    expect(istWallTimeToUtc("2026-06-25", "08:00")?.toISOString()).toBe(
      "2026-06-25T02:30:00.000Z",
    );
    expect(istWallTimeToUtc("2026-06-25", "02:00")?.toISOString()).toBe(
      "2026-06-24T20:30:00.000Z",
    );
  });
});

describe("withinQuietHours + flag helper", () => {
  it("07:00 and 22:00 inclusive; 06:59 and 22:01 out", () => {
    expect(withinQuietHours("07:00")).toBe(true);
    expect(withinQuietHours("22:00")).toBe(true);
    expect(withinQuietHours("06:59")).toBe(false);
    expect(withinQuietHours("22:01")).toBe(false);
    expect(withinQuietHours("13:30")).toBe(true);
  });

  it("isMedicationReminderEnabled is true only for exactly 'true'", () => {
    expect(
      isMedicationReminderEnabled({
        WHATSAPP_MEDICATION_REMINDER_ENABLED: "true",
      } as never),
    ).toBe(true);
    expect(isMedicationReminderEnabled({} as never)).toBe(false);
    expect(
      isMedicationReminderEnabled({
        WHATSAPP_MEDICATION_REMINDER_ENABLED: "1",
      } as never),
    ).toBe(false);
  });
});
