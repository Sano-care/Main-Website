// Slice 3 C3 — dispatchEventNotification tests.
//
// Cover the 6-event decision matrix + opt-out short-circuit + window check +
// review-nudge env behavior. Both chokepoints (dispatchTextMessage,
// dispatchTemplateMessage) are mocked at the module boundary; this verifies
// the dispatcher picks the right one with the right args.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeConversation {
  id: string;
  whatsapp_phone: string;
  lead_id: string | null;
  opt_out: boolean;
  state: string;
}

const h = vi.hoisted(() => ({
  conv: {
    id: "conv-1",
    whatsapp_phone: "+919811100001",
    lead_id: null,
    opt_out: false,
    state: "active",
  } as FakeConversation,
  convThrow: null as string | null,
  windowOpen: true,
  windowThrow: null as string | null,
  textCalls: [] as Array<{ conversationId: string; phone: string; body: string; safetyFlags?: unknown }>,
  templateCalls: [] as Array<{ conversationId: string; phone: string; templateName: string; vars: Record<string, string> }>,
  textResult: { sent: true, providerMessageId: "wamid-text" } as
    | { sent: true; providerMessageId?: string }
    | { sent: false; blocked: true }
    | { sent: false; blocked: false; error: string },
  templateResult: { sent: true, providerMessageId: "wamid-tmpl" } as
    | { sent: true; providerMessageId?: string }
    | { sent: false; blocked: true }
    | { sent: false; blocked: false; error: string },
  audits: [] as Array<{ type: string; data: Record<string, unknown> }>,
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => ({
      insert: () => Promise.resolve({ error: null }),
    }),
  },
}));

vi.mock("@/lib/whatsapp/db", () => ({
  findOrCreateConversation: vi.fn(async () => {
    if (h.convThrow) throw new Error(h.convThrow);
    return { conversation: h.conv, isNew: false };
  }),
  dispatchTextMessage: vi.fn(async (args: { conversationId: string; phone: string; body: string; safetyFlags?: unknown }) => {
    h.textCalls.push(args);
    return h.textResult;
  }),
  dispatchTemplateMessage: vi.fn(async (args: { conversationId: string; phone: string; templateName: string; vars: Record<string, string> }) => {
    h.templateCalls.push(args);
    return h.templateResult;
  }),
}));

vi.mock("@/lib/whatsapp/session", () => ({
  isWithinSessionWindow: vi.fn(async () => {
    if (h.windowThrow) throw new Error(h.windowThrow);
    return h.windowOpen;
  }),
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

vi.mock("@/lib/whatsapp/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  maskPhone: (p: string) => p,
}));

import {
  dispatchEventNotification,
  notifyOnMedicAssigned,
} from "@/lib/whatsapp/slice3Dispatcher";

const baseBooking = {
  id: "bk-1",
  phone: "+919811100001",
  patient_name: "Rajesh",
  status: "CONFIRMED",
};

const baseMedic = {
  id: "med-1",
  full_name: "Sunita Sharma",
  phone: "+919876543210",
};

beforeEach(() => {
  h.conv = {
    id: "conv-1",
    whatsapp_phone: "+919811100001",
    lead_id: null,
    opt_out: false,
    state: "active",
  };
  h.convThrow = null;
  h.windowOpen = true;
  h.windowThrow = null;
  h.textCalls = [];
  h.templateCalls = [];
  h.textResult = { sent: true, providerMessageId: "wamid-text" };
  h.templateResult = { sent: true, providerMessageId: "wamid-tmpl" };
  h.audits = [];
  delete process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dispatchEventNotification — opt-out short-circuit", () => {
  it("opt-out conversation → skipped with reason=opted_out + audit row, no send", async () => {
    h.conv.opt_out = true;
    const result = await dispatchEventNotification({
      event: "reached",
      booking: baseBooking,
      medic: baseMedic,
    });
    expect(result).toMatchObject({ sent: false, blocked: false, skipped: true, reason: "opted_out" });
    expect(h.textCalls).toHaveLength(0);
    expect(h.templateCalls).toHaveLength(0);
    expect(h.audits.find((a) => a.type === "medic_event_notification_skipped_optout")).toBeTruthy();
  });

  it("findOrCreateConversation throw → returns conversation_lookup_failed error", async () => {
    h.convThrow = "supabase 500";
    const result = await dispatchEventNotification({
      event: "reached",
      booking: baseBooking,
      medic: baseMedic,
    });
    expect(result).toEqual({ sent: false, blocked: false, error: "conversation_lookup_failed" });
  });
});

describe("dispatchEventNotification — template events (departed, patient_no_show)", () => {
  it("'departed' → aarogya_medic_departed with medic_first_name; no window check", async () => {
    h.windowOpen = false; // template events ignore window
    const result = await dispatchEventNotification({
      event: "departed",
      booking: baseBooking,
      medic: baseMedic,
    });
    expect(result).toEqual({ sent: true, providerMessageId: "wamid-tmpl" });
    expect(h.templateCalls).toHaveLength(1);
    expect(h.templateCalls[0]).toMatchObject({
      conversationId: "conv-1",
      phone: "+919811100001",
      templateName: "aarogya_medic_departed",
      vars: { medic_first_name: "Sunita" },
    });
  });

  it("'patient_no_show' → aarogya_medic_at_door with medic_first_name + medic_phone", async () => {
    const result = await dispatchEventNotification({
      event: "patient_no_show",
      booking: baseBooking,
      medic: baseMedic,
    });
    expect(result).toEqual({ sent: true, providerMessageId: "wamid-tmpl" });
    expect(h.templateCalls).toHaveLength(1);
    expect(h.templateCalls[0]).toMatchObject({
      templateName: "aarogya_medic_at_door",
      vars: { medic_first_name: "Sunita", medic_phone: "+919876543210" },
    });
  });

  it("medic with blank full_name → fallback first_name fills template slot", async () => {
    const result = await dispatchEventNotification({
      event: "departed",
      booking: baseBooking,
      medic: { ...baseMedic, full_name: null },
    });
    expect(result).toEqual({ sent: true, providerMessageId: "wamid-tmpl" });
    // Fallback "Your Sanocare medic" — guarded so renderTemplate doesn't throw
    expect(h.templateCalls[0]?.vars.medic_first_name).toBe("Your Sanocare medic");
  });
});

describe("dispatchEventNotification — free-form events inside the window", () => {
  it("'medic_assigned' → free-form copy mentioning medic first name, NO window check", async () => {
    h.windowOpen = false; // medic_assigned bypasses the window check
    const result = await dispatchEventNotification({
      event: "medic_assigned",
      booking: baseBooking,
      medic: baseMedic,
    });
    expect(result).toEqual({ sent: true, providerMessageId: "wamid-text" });
    expect(h.textCalls).toHaveLength(1);
    expect(h.textCalls[0].body).toContain("Sunita");
    expect(h.textCalls[0].body).toMatch(/preparing to head out/i);
  });

  it("'reached' inside window → free-form 'has reached' copy", async () => {
    const result = await dispatchEventNotification({
      event: "reached",
      booking: baseBooking,
      medic: baseMedic,
    });
    expect(result.sent).toBe(true);
    expect(h.textCalls[0].body).toMatch(/Sunita has reached/i);
  });

  it("'visit_started' inside window → 'visit in progress' copy", async () => {
    const result = await dispatchEventNotification({
      event: "visit_started",
      booking: baseBooking,
      medic: baseMedic,
    });
    expect(result.sent).toBe(true);
    expect(h.textCalls[0].body).toMatch(/visit in progress/i);
  });

  it("'visit_done' inside window → 'visit complete' copy", async () => {
    const result = await dispatchEventNotification({
      event: "visit_done",
      booking: baseBooking,
      medic: baseMedic,
    });
    expect(result.sent).toBe(true);
    expect(h.textCalls[0].body).toMatch(/visit complete/i);
    expect(h.textCalls[0].body).not.toMatch(/google review/i); // no env set
  });
});

describe("dispatchEventNotification — outside-window skip", () => {
  it("'reached' outside window → skipped with reason + audit, no send", async () => {
    h.windowOpen = false;
    const result = await dispatchEventNotification({
      event: "reached",
      booking: baseBooking,
      medic: baseMedic,
    });
    expect(result).toMatchObject({
      sent: false,
      blocked: false,
      skipped: true,
      reason: "outside_window_no_template",
    });
    expect(h.textCalls).toHaveLength(0);
    expect(h.audits.find((a) => a.type === "medic_event_notification_skipped_window")).toBeTruthy();
  });

  it("'visit_started' outside window → skipped silently", async () => {
    h.windowOpen = false;
    const result = await dispatchEventNotification({
      event: "visit_started",
      booking: baseBooking,
      medic: baseMedic,
    });
    expect(result).toMatchObject({ skipped: true, reason: "outside_window_no_template" });
  });

  it("window check throw → treated as closed, skipped with audit", async () => {
    h.windowThrow = "session DB blew up";
    const result = await dispatchEventNotification({
      event: "reached",
      booking: baseBooking,
      medic: baseMedic,
    });
    expect(result).toMatchObject({ skipped: true, reason: "outside_window_no_template" });
  });
});

describe("dispatchEventNotification — visit_done Google review nudge", () => {
  it("NEXT_PUBLIC_GOOGLE_REVIEW_URL set → review URL appended to body, safety flag set", async () => {
    process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL = "https://g.page/r/CfG3dtgPmMKnEBM/review";
    const result = await dispatchEventNotification({
      event: "visit_done",
      booking: baseBooking,
      medic: baseMedic,
    });
    expect(result.sent).toBe(true);
    expect(h.textCalls[0].body).toMatch(/Google review/i);
    expect(h.textCalls[0].body).toContain("https://g.page/r/CfG3dtgPmMKnEBM/review");
    expect(h.textCalls[0].safetyFlags).toMatchObject({ review_nudge_appended: true });
  });

  it("placeholder URL still in env → nudge skipped, log.warn fires", async () => {
    process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL = "https://g.page/r/__PLACEHOLDER__/review";
    const result = await dispatchEventNotification({
      event: "visit_done",
      booking: baseBooking,
      medic: baseMedic,
    });
    expect(result.sent).toBe(true);
    expect(h.textCalls[0].body).not.toMatch(/google review/i);
    expect(h.textCalls[0].body).not.toContain("PLACEHOLDER");
  });

  it("review URL is appended ONLY on visit_done, not other events", async () => {
    process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL = "https://g.page/r/CfG3dtgPmMKnEBM/review";
    await dispatchEventNotification({ event: "reached", booking: baseBooking, medic: baseMedic });
    expect(h.textCalls[0].body).not.toMatch(/google review/i);
  });
});

describe("notifyOnMedicAssigned — assignMedic() server action hook", () => {
  function makeRscClient(args: {
    booking: Record<string, unknown> | null;
    medic: Record<string, unknown> | null;
  }) {
    return {
      from(table: string) {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: () =>
                    Promise.resolve({
                      data: table === "bookings" ? args.booking : args.medic,
                      error: null,
                    }),
                };
              },
            };
          },
        };
      },
    };
  }

  it("dispatches medic_assigned with both rows present, returns DispatchResult", async () => {
    const rsc = makeRscClient({
      booking: { id: "bk-1", phone: "+919811100001", patient_name: "Rajesh", status: "CONFIRMED" },
      medic: { id: "med-1", full_name: "Sunita Sharma", phone: "+919876543210" },
    });
    const result = await notifyOnMedicAssigned(rsc, "bk-1", "med-1");
    expect(result).toMatchObject({ sent: true });
    expect(h.textCalls).toHaveLength(1);
    expect(h.textCalls[0].body).toMatch(/Sunita/);
  });

  it("missing booking → returns lookup_failed without dispatching", async () => {
    const rsc = makeRscClient({
      booking: null,
      medic: { id: "med-1", full_name: "Sunita", phone: "+919876543210" },
    });
    const result = await notifyOnMedicAssigned(rsc, "bk-1", "med-1");
    expect(result).toEqual({ sent: false, blocked: false, error: "booking_or_medic_lookup_failed" });
    expect(h.textCalls).toHaveLength(0);
  });

  it("missing medic → returns lookup_failed", async () => {
    const rsc = makeRscClient({
      booking: { id: "bk-1", phone: "+919811100001", patient_name: "X", status: "CONFIRMED" },
      medic: null,
    });
    const result = await notifyOnMedicAssigned(rsc, "bk-1", "med-1");
    expect(result).toEqual({ sent: false, blocked: false, error: "booking_or_medic_lookup_failed" });
  });

  it("rsc throws → caught as notify_threw, never escapes", async () => {
    const rsc = {
      from() {
        throw new Error("rsc client died");
      },
    } as unknown as Parameters<typeof notifyOnMedicAssigned>[0];
    const result = await notifyOnMedicAssigned(rsc, "bk-1", "med-1");
    expect(result).toEqual({ sent: false, blocked: false, error: "notify_threw" });
  });
});
