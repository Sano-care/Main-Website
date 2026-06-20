// Slice 3 C4 — POST /api/medic-app/event handler tests.
//
// Mocks the supabase service client and slice3Dispatcher to verify per-branch
// audit emission + side effects + that notification failures DON'T block the
// medic-app POST response.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeBookingRow {
  id: string;
  medic_id?: string;
  phone?: string;
  patient_name?: string | null;
  status?: string | null;
}

const h = vi.hoisted(() => ({
  // Booking lookup (initial — has only id + medic_id)
  initialBooking: null as FakeBookingRow | null,
  // Booking detail (second lookup for dispatch)
  bookingDetail: null as FakeBookingRow | null,
  // Medic lookup
  medicRow: null as { id: string; full_name: string | null; phone: string } | null,
  // Dedupe lookup
  existingEvent: null as { id: string; occurred_at: string } | null,
  // Insert result + error
  insertResult: null as { id: string; occurred_at: string } | null,
  insertError: null as { message: string } | null,
  // visit_done bookings.update behavior
  bookingsUpdateError: null as { message: string } | null,
  // patient_no_show queue insert
  queueInsertError: null as { code?: string; message: string } | null,
  // Audit + dispatch capture
  audits: [] as Array<{ type: string; data: Record<string, unknown> }>,
  dispatchCalls: [] as Array<{ event: string; bookingId: string; medicId: string }>,
  dispatchResult: { sent: true, providerMessageId: "wamid-1" } as unknown,
  dispatchThrow: null as string | null,
  medicAuth: { medic_id: "med-1" } as { medic_id: string },
  // Track table operations for assertions
  bookingsUpdated: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  queueInserts: [] as Array<{ booking_id: string; medic_id: string }>,
}));

// Mock requireMedic — returns the configured auth or NextResponse
vi.mock("@/lib/auth/requireMedic", () => ({
  requireMedic: vi.fn(async () => h.medicAuth),
}));

// Mock the supabase client factory
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "bookings") {
        const builder = {
          _select: false,
          _patch: null as Record<string, unknown> | null,
          _idForUpdate: null as string | null,
          select: () => builder,
          eq: (col: string, val: string) => {
            if (builder._patch) {
              builder._idForUpdate = val;
            }
            return builder;
          },
          maybeSingle: () => {
            // Two lookups: initial (select id, medic_id) vs detail (select id, phone, patient_name, status)
            const data = builder._select === false
              ? null
              : builder._lookupType === "detail"
              ? h.bookingDetail
              : h.initialBooking;
            return Promise.resolve({ data, error: null });
          },
          update: (patch: Record<string, unknown>) => {
            builder._patch = patch;
            return {
              eq: (_col: string, val: string) => {
                h.bookingsUpdated.push({ id: val, patch });
                return Promise.resolve({ error: h.bookingsUpdateError });
              },
            };
          },
          // Hack — track which select was called via a flag
          _lookupType: "initial" as "initial" | "detail",
          _selectFields: "" as string,
        };
        builder.select = (fields?: string) => {
          builder._select = true;
          builder._selectFields = fields ?? "";
          if (fields && fields.includes("phone")) builder._lookupType = "detail";
          return builder;
        };
        return builder;
      }
      if (table === "medic_event_log") {
        const builder = {
          _select: false,
          select: () => {
            builder._select = true;
            return builder;
          },
          eq: () => builder,
          maybeSingle: () =>
            Promise.resolve({ data: h.existingEvent, error: null }),
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: h.insertResult,
                  error: h.insertError,
                }),
            }),
          }),
        };
        return builder;
      }
      if (table === "medics") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: h.medicRow, error: null }),
            }),
          }),
        };
      }
      if (table === "no_show_escalation_queue") {
        return {
          insert: (row: { booking_id: string; medic_id: string; no_show_at: string }) => {
            h.queueInserts.push({ booking_id: row.booking_id, medic_id: row.medic_id });
            return Promise.resolve({ error: h.queueInsertError });
          },
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
    },
  }),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => ({
      insert: () => Promise.resolve({ error: null }),
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
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

vi.mock("@/lib/whatsapp/slice3Dispatcher", () => ({
  dispatchEventNotification: vi.fn(async (args: { event: string; booking: { id: string }; medic: { id: string } }) => {
    if (h.dispatchThrow) throw new Error(h.dispatchThrow);
    h.dispatchCalls.push({ event: args.event, bookingId: args.booking.id, medicId: args.medic.id });
    return h.dispatchResult;
  }),
}));

// Stub env so createServiceClient returns truthy
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";

import { POST } from "@/app/api/medic-app/event/route";

beforeEach(() => {
  h.initialBooking = { id: "bk-1", medic_id: "med-1" };
  h.bookingDetail = {
    id: "bk-1",
    phone: "+919811100001",
    patient_name: "Rajesh",
    status: "CONFIRMED",
  };
  h.medicRow = { id: "med-1", full_name: "Sunita Sharma", phone: "+919876543210" };
  h.existingEvent = null;
  h.insertResult = { id: "evt-1", occurred_at: "2026-06-19T10:00:00Z" };
  h.insertError = null;
  h.bookingsUpdateError = null;
  h.queueInsertError = null;
  h.audits = [];
  h.dispatchCalls = [];
  h.dispatchResult = { sent: true, providerMessageId: "wamid-1" };
  h.dispatchThrow = null;
  h.medicAuth = { medic_id: "med-1" };
  h.bookingsUpdated = [];
  h.queueInserts = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeReq(body: Record<string, unknown>) {
  return new Request("http://test/api/medic-app/event", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as Parameters<typeof POST>[0];
}

describe("POST /api/medic-app/event — Slice 3 wire-up", () => {
  it("new insert + happy dispatch: 201 + dispatch fired + sent audit", async () => {
    const res = await POST(makeReq({ booking_id: "11111111-2222-3333-4444-555555555555", event: "reached" }));
    expect(res.status).toBe(201);
    expect(h.dispatchCalls).toHaveLength(1);
    expect(h.dispatchCalls[0].event).toBe("reached");
    expect(h.audits.map((a) => a.type)).toContain("medic_event_received");
    expect(h.audits.map((a) => a.type)).toContain("medic_event_inserted");
    expect(h.audits.map((a) => a.type)).toContain("medic_event_notification_sent");
  });

  it("duplicate POST (existing row) → idempotent_return audit + 200 + NO dispatch", async () => {
    h.existingEvent = { id: "evt-dupe", occurred_at: "2026-06-19T09:00:00Z" };
    const res = await POST(makeReq({ booking_id: "11111111-2222-3333-4444-555555555555", event: "reached" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deduped?: boolean };
    expect(body.deduped).toBe(true);
    expect(h.dispatchCalls).toHaveLength(0);
    expect(h.audits.find((a) => a.type === "medic_event_idempotent_return")).toBeTruthy();
    expect(h.audits.find((a) => a.type === "medic_event_inserted")).toBeUndefined();
  });

  it("unknown booking → 404 + medic_event_unknown_booking audit, no dispatch", async () => {
    h.initialBooking = null;
    const res = await POST(makeReq({ booking_id: "11111111-2222-3333-4444-555555555555", event: "reached" }));
    expect(res.status).toBe(404);
    expect(h.dispatchCalls).toHaveLength(0);
    expect(h.audits.find((a) => a.type === "medic_event_unknown_booking")).toBeTruthy();
  });

  it("cancelled booking → 409 + medic_event_cancelled_booking audit, no dispatch", async () => {
    h.bookingDetail = { ...h.bookingDetail!, status: "CANCELLED" };
    const res = await POST(makeReq({ booking_id: "11111111-2222-3333-4444-555555555555", event: "reached" }));
    expect(res.status).toBe(409);
    expect(h.dispatchCalls).toHaveLength(0);
    expect(h.audits.find((a) => a.type === "medic_event_cancelled_booking")).toBeTruthy();
  });

  it("visit_done: bookings.status → COMPLETED + status_updated audit + dispatch", async () => {
    const res = await POST(makeReq({ booking_id: "11111111-2222-3333-4444-555555555555", event: "visit_done" }));
    expect(res.status).toBe(201);
    expect(h.bookingsUpdated.find((u) => u.id === "11111111-2222-3333-4444-555555555555" && u.patch.status === "COMPLETED")).toBeTruthy();
    expect(h.audits.find((a) => a.type === "medic_event_booking_status_updated")).toBeTruthy();
    expect(h.dispatchCalls[0]?.event).toBe("visit_done");
  });

  it("patient_no_show: queue row inserted + no_show_escalation_pending audit + template dispatch", async () => {
    const res = await POST(makeReq({ booking_id: "11111111-2222-3333-4444-555555555555", event: "patient_no_show" }));
    expect(res.status).toBe(201);
    expect(h.queueInserts).toEqual([{ booking_id: "11111111-2222-3333-4444-555555555555", medic_id: "med-1" }]);
    expect(h.audits.find((a) => a.type === "no_show_escalation_pending")).toBeTruthy();
    expect(h.dispatchCalls[0]?.event).toBe("patient_no_show");
  });

  it("notification throw → 201 still returned (medic-app sees its insert), failure audit written", async () => {
    h.dispatchThrow = "claude api down";
    const res = await POST(makeReq({ booking_id: "11111111-2222-3333-4444-555555555555", event: "reached" }));
    expect(res.status).toBe(201);
    expect(h.audits.find((a) => a.type === "medic_event_notification_failed")).toBeTruthy();
  });

  it("dispatcher returns blocked → no notification_failed audit (chokepoint already audited)", async () => {
    h.dispatchResult = { sent: false, blocked: true };
    const res = await POST(makeReq({ booking_id: "11111111-2222-3333-4444-555555555555", event: "reached" }));
    expect(res.status).toBe(201);
    expect(h.audits.find((a) => a.type === "medic_event_notification_failed")).toBeUndefined();
    expect(h.audits.find((a) => a.type === "medic_event_notification_sent")).toBeUndefined();
  });

  it("dispatcher returns skipped (window) → no notification_failed audit", async () => {
    h.dispatchResult = { sent: false, blocked: false, skipped: true, reason: "outside_window_no_template" };
    const res = await POST(makeReq({ booking_id: "11111111-2222-3333-4444-555555555555", event: "reached" }));
    expect(res.status).toBe(201);
    expect(h.audits.find((a) => a.type === "medic_event_notification_failed")).toBeUndefined();
  });

  it("dispatcher returns error → notification_failed audit with error string", async () => {
    h.dispatchResult = { sent: false, blocked: false, error: "permanent_template_paused" };
    const res = await POST(makeReq({ booking_id: "11111111-2222-3333-4444-555555555555", event: "reached" }));
    expect(res.status).toBe(201);
    const failed = h.audits.find((a) => a.type === "medic_event_notification_failed");
    expect(failed?.data.error).toBe("permanent_template_paused");
  });

  it("patient_no_show validates against M059's expanded enum", async () => {
    // VALID_EVENTS includes patient_no_show; this exercises that path
    // doesn't hit a 400.
    const res = await POST(makeReq({ booking_id: "11111111-2222-3333-4444-555555555555", event: "patient_no_show" }));
    expect(res.status).not.toBe(400);
  });
});
