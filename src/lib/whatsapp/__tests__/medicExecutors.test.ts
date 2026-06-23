// Medic Help-Mode Part 1 — executor behaviour + identity gates.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import {
  executeEscalateToDoctor,
  executeFetchBookingContext,
  executeLogMedicQuery,
  type OpsHandoffFn,
} from "@/lib/whatsapp/medicExecutors";
import type { Identity } from "@/lib/whatsapp/identity";

const medic: Identity = { role: "medic", medicId: "med-1", fullName: "Asha Devi" };
const patient: Identity = { role: "customer", subRole: "registered", customerId: "c1" };

/** Minimal fake of the bookings .select().eq().maybeSingle() chain. */
function bookingsSupabase(row: Record<string, unknown> | null) {
  let lastFilter: { col: string; val: unknown } | null = null;
  return {
    client: {
      from: () => ({
        select: () => ({
          eq: (col: string, val: unknown) => {
            lastFilter = { col, val };
            return { maybeSingle: async () => ({ data: row, error: null }) };
          },
        }),
      }),
    } as never,
    getFilter: () => lastFilter,
  };
}

describe("executeEscalateToDoctor", () => {
  let sendOpsHandoff: ReturnType<typeof vi.fn>;
  let writeAuditFn: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    sendOpsHandoff = vi.fn(async () => {});
    writeAuditFn = vi.fn(async () => true);
  });

  it("medic → alerts ops tagged [MEDIC→DOCTOR] with reason + name, audits, confirms", async () => {
    const reply = await executeEscalateToDoctor({
      identity: medic,
      conversationId: "conv-1",
      medicPhone: "+9199",
      input: { reason: "BP 180/110, unsure if I should proceed" },
      sendOpsHandoff: sendOpsHandoff as unknown as OpsHandoffFn,
      deps: { writeAuditFn },
    });
    expect(sendOpsHandoff).toHaveBeenCalledTimes(1);
    const handoff = sendOpsHandoff.mock.calls[0][0];
    expect(handoff.patientName).toContain("[MEDIC→DOCTOR]");
    expect(handoff.patientName).toContain("Asha Devi");
    expect(handoff.context).toContain("BP 180/110");
    expect(handoff.escalationId).toBeNull(); // no typed escalations row in Part 1
    expect(writeAuditFn).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "medic_escalation_to_doctor",
        eventData: expect.objectContaining({ medic_id: "med-1" }),
      }),
    );
    expect(reply).toContain("on-call doctor");
  });

  it("non-medic → refused, ops NOT alerted, no audit", async () => {
    const reply = await executeEscalateToDoctor({
      identity: patient,
      conversationId: "conv-1",
      medicPhone: "+9199",
      input: { reason: "x" },
      sendOpsHandoff: sendOpsHandoff as unknown as OpsHandoffFn,
      deps: { writeAuditFn },
    });
    expect(sendOpsHandoff).not.toHaveBeenCalled();
    expect(writeAuditFn).not.toHaveBeenCalled();
    expect(reply).toBe("That action isn't available here.");
  });
});

describe("executeFetchBookingContext — ownership gate", () => {
  it("returns details when the booking belongs to the calling medic", async () => {
    const { client } = bookingsSupabase({
      id: "b1", booking_code: "SAN-1", medic_id: "med-1",
      patient_name: "Ravi", service_category: "home-nursing",
      specific_ailment: "post-op", manual_address: "H-12", status: "DISPATCHED",
      scheduled_for: "2026-06-23T10:00:00+05:30",
    });
    const out = await executeFetchBookingContext({
      identity: medic, input: { booking_id: "SAN-1" }, deps: { supabase: client },
    });
    expect(out).toContain("SAN-1");
    expect(out).toContain("Ravi");
    expect(out).toContain("home-nursing");
    expect(out).toContain("DISPATCHED");
  });

  it("refuses a booking assigned to a DIFFERENT medic", async () => {
    const { client } = bookingsSupabase({
      id: "b1", booking_code: "SAN-1", medic_id: "med-OTHER",
      patient_name: "Ravi", service_category: "home-nursing",
      specific_ailment: null, manual_address: "H-12", status: "DISPATCHED",
      scheduled_for: null,
    });
    const out = await executeFetchBookingContext({
      identity: medic, input: { booking_id: "SAN-1" }, deps: { supabase: client },
    });
    expect(out).toContain("isn't assigned to you");
    expect(out).not.toContain("Ravi");
  });

  it("refuses (same message) when the booking is not found — no existence leak", async () => {
    const { client } = bookingsSupabase(null);
    const out = await executeFetchBookingContext({
      identity: medic, input: { booking_id: "SAN-NOPE" }, deps: { supabase: client },
    });
    expect(out).toContain("isn't assigned to you");
  });

  it("queries by booking_code for a non-UUID, by id for a UUID", async () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    const f1 = bookingsSupabase({ id: uuid, booking_code: null, medic_id: "med-1", patient_name: "R", service_category: "lab-tests", specific_ailment: null, manual_address: "A", status: "PENDING", scheduled_for: null });
    await executeFetchBookingContext({ identity: medic, input: { booking_id: uuid }, deps: { supabase: f1.client } });
    expect(f1.getFilter()).toEqual({ col: "id", val: uuid });

    const f2 = bookingsSupabase({ id: "b1", booking_code: "SAN-9", medic_id: "med-1", patient_name: "R", service_category: "lab-tests", specific_ailment: null, manual_address: "A", status: "PENDING", scheduled_for: null });
    await executeFetchBookingContext({ identity: medic, input: { booking_id: "SAN-9" }, deps: { supabase: f2.client } });
    expect(f2.getFilter()).toEqual({ col: "booking_code", val: "SAN-9" });
  });

  it("non-medic → refused without querying", async () => {
    const { client } = bookingsSupabase({ id: "b1", medic_id: "med-1" });
    const out = await executeFetchBookingContext({
      identity: patient, input: { booking_id: "SAN-1" }, deps: { supabase: client },
    });
    expect(out).toBe("That action isn't available here.");
  });
});

describe("executeLogMedicQuery", () => {
  it("medic → appends a medic_query audit row, returns null", async () => {
    const writeAuditFn = vi.fn(async () => true);
    const out = await executeLogMedicQuery({
      identity: medic, conversationId: "conv-1",
      input: { question: "How do I mark a visit done?" }, deps: { writeAuditFn },
    });
    expect(out).toBeNull();
    expect(writeAuditFn).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "medic_query",
        eventData: expect.objectContaining({ medic_id: "med-1", question: "How do I mark a visit done?" }),
      }),
    );
  });

  it("non-medic → no audit, returns null", async () => {
    const writeAuditFn = vi.fn(async () => true);
    const out = await executeLogMedicQuery({
      identity: patient, conversationId: "conv-1",
      input: { question: "x" }, deps: { writeAuditFn },
    });
    expect(out).toBeNull();
    expect(writeAuditFn).not.toHaveBeenCalled();
  });
});
