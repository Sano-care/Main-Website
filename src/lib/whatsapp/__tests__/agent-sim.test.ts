// End-to-end SIMULATION of the inbound WhatsApp chain, secret-free.
//
// Drives realistic Meta webhook payloads through processWebhook → the REAL
// adapter + REAL orchestrator (runAgentTurn / model selection / tool plumbing)
// with only the EXTERNAL boundaries stubbed:
//   - @/lib/agent/client.generateResponse  (Claude HTTP)        -> scripted
//   - @/lib/whatsapp/cloud-api.sendTemplateMessage (Meta send)  -> recorded
//   - @/lib/whatsapp/db.*  (Supabase)                           -> in-memory
//   - @/lib/whatsapp/safety/audit.writeAudit (Supabase)         -> recorded
//
// Proves the code path the founder asked about: inbound parsed → pre-checks →
// orchestrator → reply queued → escalate_to_ops path runs (template params it
// WOULD send are asserted; nothing is actually sent). It does NOT test the live
// LLM's qualification quality — that's validated in the monitored Day-7 run.

import { describe, it, expect, vi, beforeEach } from "vitest";

const rec = vi.hoisted(() => ({
  log: [] as string[],
  replies: [] as string[],
  templateSends: [] as Array<{
    to: string;
    templateName: string;
    bodyParams: string[];
    quickReplyPayload?: string;
  }>,
  escalations: [] as Array<{ type: string; priority: string }>,
  leadUpdates: [] as Array<Record<string, unknown>>,
  optOuts: 0,
  scripted: [] as Array<{
    text: string;
    toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>;
    stopReason: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
  }>,
  optOutFlag: false, // simulated conversations.opt_out
  bookingLookup: { latest: null, latestActive: null, activeCount: 0 } as {
    latest: Record<string, unknown> | null;
    latestActive: Record<string, unknown> | null;
    activeCount: number;
  },
  cancelled: [] as Array<{ id: string; reason: string }>,
  complaints: [] as Array<Record<string, unknown>>,
}));

// --- Booking/complaint data layer (Slice 1) --------------------------------
vi.mock("@/lib/agent/bookings", () => ({
  mapServiceCategory: () => "home_visit",
  normalizePhoneLast10: (p: string) => (p ?? "").replace(/\D/g, "").slice(-10),
  findBookingsByPhone: vi.fn(async () => rec.bookingLookup),
  cancelBookingById: vi.fn(async (id: string, reason: string) => {
    rec.cancelled.push({ id, reason });
    rec.log.push(`  booking ${id} CANCELLED (${reason})`);
    return true;
  }),
  insertComplaint: vi.fn(async (c: Record<string, unknown>) => {
    rec.complaints.push(c);
    rec.log.push(`  complaint logged: ${c.category} / ${c.severity}`);
    return "cmp-1";
  }),
}));

// --- Claude client: return the next scripted response -----------------------
vi.mock("@/lib/agent/client", () => ({
  generateResponse: vi.fn(async (req: { model: string; messages: { content: string }[] }) => {
    rec.log.push(`  claude(${req.model}) ← "${req.messages.at(-1)?.content}"`);
    const next = rec.scripted.shift();
    if (!next) throw new Error("no scripted Claude response queued");
    return next;
  }),
}));

// --- WhatsApp Cloud API: record template sends ------------------------------
vi.mock("@/lib/whatsapp/cloud-api", () => ({
  CloudApiError: class CloudApiError extends Error {},
  sendTextMessage: vi.fn(async () => ({ providerMessageId: "wamid.text" })),
  sendTemplateMessage: vi.fn(
    async (a: { to: string; templateName: string; bodyParams: string[]; quickReplyPayload?: string }) => {
      rec.templateSends.push(a);
      rec.log.push(
        `  TEMPLATE ${a.templateName} → ${a.to}  body=[${a.bodyParams.join(" | ")}]  payload=${a.quickReplyPayload}`,
      );
      return { providerMessageId: "wamid.tmpl" };
    },
  ),
}));

// --- DB layer: in-memory ----------------------------------------------------
vi.mock("@/lib/whatsapp/db", () => ({
  findOrCreateConversation: vi.fn(async (phone: string) => ({
    conversation: { id: "conv-1", whatsapp_phone: phone, lead_id: "lead-1", opt_out: rec.optOutFlag, state: "greeting" },
    isNew: true,
  })),
  recordInboundMessage: vi.fn(async () => ({ inserted: true })),
  loadHistory: vi.fn(async () => []),
  countInboundMessages: vi.fn(async () => 4),
  dispatchTextMessage: vi.fn(async (a: { phone: string; body: string }) => {
    if (rec.optOutFlag) {
      rec.log.push(`  reply BLOCKED (opt_out) → ${a.phone}`);
      return { sent: false as const, blocked: true as const };
    }
    rec.replies.push(a.body);
    rec.log.push(`  reply → ${a.phone}: "${a.body}"`);
    return { sent: true as const, providerMessageId: "wamid.out" };
  }),
  createEscalation: vi.fn(async (a: { escalationType: string; priority: string }) => {
    rec.escalations.push({ type: a.escalationType, priority: a.priority });
    rec.log.push(`  escalation row: ${a.escalationType} / ${a.priority}`);
    return "esc-1";
  }),
  updateLeadFields: vi.fn(async (_id: string | null, f: Record<string, unknown>) => {
    rec.leadUpdates.push(f);
    rec.log.push(`  lead update: ${JSON.stringify(f)}`);
  }),
  setEscalationProviderMessageId: vi.fn(async () => {}),
  markEscalationAttended: vi.fn(async () => "esc-1"),
  setOptOut: vi.fn(async () => {
    rec.optOuts += 1;
    rec.optOutFlag = true;
    rec.log.push(`  opt_out SET (permanent)`);
  }),
}));

// --- Audit: fully mocked (so the real module's Supabase client never loads).
// AuditEvent via Proxy returns the accessed key name as the event string.
vi.mock("@/lib/whatsapp/safety/audit", () => ({
  AuditEvent: new Proxy({} as Record<string, string>, { get: (_t, p) => String(p) }),
  writeAudit: vi.fn(async (e: { eventType: string }) => {
    rec.log.push(`  audit: ${e.eventType}`);
    return true;
  }),
}));

// Identity resolution (T-Aarogya-P1) talks to Supabase directly; stub it so the
// sim stays DB-free. role:"new" → existing patient flow, behaviour unchanged.
vi.mock("@/lib/whatsapp/identity", () => ({
  resolveIdentity: vi.fn(async () => ({ role: "new" })),
  identityForAudit: (id: { role: string }) => ({ role: id.role, identifiers: {} }),
}));

// Slice 4a — adapter.ts now imports modules that touch supabase-server at
// module-load. Stub the supabase client so this test can run without env vars
// AND short-circuit the new context loaders to no-ops (sim covers the existing
// patient flow; the new tools are unit-tested separately).
vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          single: () => Promise.resolve({ data: null, error: null }),
        }),
        ilike: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      insert: () => ({
        select: () => ({
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/whatsapp/customerContext", () => ({
  loadTier1Context: vi.fn(async () => ({
    identity: { role: "new" },
    customer: null,
    last_booking: null,
    carehub: null,
    language: null,
  })),
}));
vi.mock("@/lib/whatsapp/opsRouter", () => ({
  findLatestUnexpiredRelayDraft: vi.fn(async () => null),
}));
vi.mock("@/lib/whatsapp/slice4aExecutors", () => ({
  executeConfirmRelay: vi.fn(async () => "stub"),
  executeGetBookingHistory: vi.fn(async () => "stub"),
  executeGetFamilyMembers: vi.fn(async () => "stub"),
  executeRelayToPatient: vi.fn(async () => "stub"),
  persistConversationLanguage: vi.fn(async () => undefined),
}));

import { processWebhook } from "@/lib/whatsapp/adapter";

function envelope(from: string, text: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "1164864373371948" },
              contacts: [{ wa_id: from, profile: { name: "Test Patient" } }],
              messages: [
                {
                  from,
                  id: `wamid.${Math.abs(hash(text + from))}`,
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const PATIENT = "919812345678";

beforeEach(() => {
  process.env.MY_PERSONAL_WHATSAPP = "+919760059900"; // ops number (read at call time)
  rec.log = [];
  rec.replies = [];
  rec.templateSends = [];
  rec.escalations = [];
  rec.leadUpdates = [];
  rec.optOuts = 0;
  rec.scripted = [];
  rec.optOutFlag = false;
  rec.bookingLookup = { latest: null, latestActive: null, activeCount: 0 };
  rec.cancelled = [];
  rec.complaints = [];
});

// Helper: script a Claude turn that calls one tool (text is overridden by the
// tool's patient_message for the Slice-1 tools).
function scriptToolCall(name: string, input: Record<string, unknown> = {}) {
  rec.scripted.push({
    text: "",
    toolUses: [{ id: "tu", name, input }],
    stopReason: "tool_use",
    model: "claude-sonnet-4-6",
    tokensIn: 1500,
    tokensOut: 60,
  });
}

describe("Aarogya inbound chain — simulated end-to-end", () => {
  it("S1 greeting/triage — Claude replies, no tools", async () => {
    rec.scripted.push({
      text: "Namaste! I'm Aarogya from Sanocare 🌿 — your Care Expert. What do you need today?\n1) Home Visit + Doctor Consult (₹499+)\n2) Home Nursing (₹199+)\n3) Lab Test at Home (₹200+)\n4) Teleconsultation (₹399+)\n(AI assistant. Real care delivered by qualified Sanocare medics and doctors.)",
      toolUses: [],
      stopReason: "end_turn",
      model: "claude-haiku-4-5-20251001",
      tokensIn: 1200,
      tokensOut: 90,
    });
    rec.log.push("S1 inbound: 'hi'");
    await processWebhook(envelope(PATIENT, "hi"));
    console.log("\n--- S1 greeting ---\n" + rec.log.join("\n"));
    expect(rec.replies[0]).toContain("Aarogya");
    expect(rec.templateSends).toHaveLength(0);
  });

  it("S2 qualified lead — Claude emits escalate_to_ops → template would send", async () => {
    rec.scripted.push({
      text: "Thank you. A Medic will reach you within 30 minutes; the exact amount is settled at the door.",
      toolUses: [
        {
          id: "tu_1",
          name: "escalate_to_ops",
          input: {
            escalation_type: "qualified_lead",
            service_intent: "doctor_visit",
            urgency: "today",
            patient_name: "Mrs Sushma Sharma",
            patient_age: "68 y",
            patient_relationship: "parent",
            location: "Greater Kailash 1, New Delhi",
            context: "post knee surgery, needs home assessment",
            summary_for_ops: "68F GK-1, post knee surgery, Home Visit today",
          },
        },
      ],
      stopReason: "tool_use",
      model: "claude-sonnet-4-6",
      tokensIn: 1800,
      tokensOut: 140,
    });
    rec.log.push("S2 inbound: full qualifying details");
    await processWebhook(
      envelope(PATIENT, "My mother Mrs Sushma Sharma, 68, had knee surgery. We're in Greater Kailash 1. Need a home visit today."),
    );
    console.log("\n--- S2 qualified lead ---\n" + rec.log.join("\n"));

    // reply queued to the patient
    expect(rec.replies[0]).toContain("Medic will reach you");
    // escalation row created
    expect(rec.escalations).toEqual([{ type: "qualified_lead", priority: "p2" }]);
    // lead profile updated with captured fields
    expect(rec.leadUpdates[0]).toMatchObject({ name: "Mrs Sushma Sharma", service_intent: "doctor_visit", urgency: "today" });
    // ops handoff template WOULD send, mapped correctly (service display + mobile + payload=escalation id)
    expect(rec.templateSends).toHaveLength(1);
    const t = rec.templateSends[0];
    expect(t.templateName).toBe("aarogya_lead_alert");
    expect(t.to).toBe(process.env.MY_PERSONAL_WHATSAPP ?? t.to); // ops number from env (unset in sim → undefined path logged)
    expect(t.bodyParams[0]).toBe("Mrs Sushma Sharma");
    expect(t.bodyParams[2]).toBe("Home Visit"); // doctor_visit → display
    expect(t.bodyParams[5]).toBe("+" + PATIENT); // patient mobile E.164
    expect(t.quickReplyPayload).toBe("esc-1"); // escalation_id rides the button payload
  });

  it("S3 emergency — deterministic 112 + p1 ops alert, Claude NOT called", async () => {
    // No scripted response: the deterministic pre-check must short-circuit
    // before any LLM call. If Claude were called, the mock would throw.
    rec.log.push("S3 inbound: 'my father has chest pain'");
    await processWebhook(envelope(PATIENT, "my father has chest pain"));
    console.log("\n--- S3 emergency ---\n" + rec.log.join("\n"));

    expect(rec.replies[0]).toContain("112"); // 112 canned response
    expect(rec.escalations).toEqual([{ type: "emergency", priority: "p1" }]);
    expect(rec.templateSends[0]?.templateName).toBe("aarogya_lead_alert"); // ops alerted
    expect(rec.templateSends[0]?.bodyParams[2]).toContain("EMERGENCY");
  });

  it("S4 opt-out — confirmation sent, then permanent block engages", async () => {
    rec.log.push("S4 inbound: 'STOP'");
    await processWebhook(envelope(PATIENT, "STOP"));
    console.log("\n--- S4 opt-out ---\n" + rec.log.join("\n"));

    expect(rec.replies[0]).toContain("won't message you again");
    expect(rec.optOuts).toBe(1);
    expect(rec.optOutFlag).toBe(true); // block now permanent
  });

  // ---- Slice 1: booking-aware tools ------------------------------------
  it("S5 status check at DISPATCHED — returns the Medic name", async () => {
    rec.bookingLookup = {
      latest: { id: "b1", status: "DISPATCHED", assigned_paramedic: "Ravi Kumar", service_category: "homecare" },
      latestActive: { id: "b1", status: "DISPATCHED" },
      activeCount: 1,
    };
    scriptToolCall("check_medic_status");
    await processWebhook(envelope(PATIENT, "where is my medic?"));
    console.log("\n--- S5 status DISPATCHED ---\n" + rec.log.join("\n"));
    expect(rec.replies[0]).toContain("Ravi Kumar");
    expect(rec.replies[0]).toContain("dispatched");
  });

  it("S6 status check, no booking — offers a new one", async () => {
    rec.bookingLookup = { latest: null, latestActive: null, activeCount: 0 };
    scriptToolCall("check_medic_status");
    await processWebhook(envelope(PATIENT, "any update on my visit?"));
    console.log("\n--- S6 status none ---\n" + rec.log.join("\n"));
    expect(rec.replies[0]).toContain("don't see an active booking");
  });

  it("S7 cancel at PENDING (fee acknowledged) — free, success, ops alerted", async () => {
    rec.bookingLookup = {
      latest: { id: "b2", status: "PENDING", service_category: "homecare" },
      latestActive: { id: "b2", status: "PENDING", service_category: "homecare" },
      activeCount: 1,
    };
    scriptToolCall("cancel_booking", { reason: "plans changed", patient_acknowledged_fee: true });
    await processWebhook(envelope(PATIENT, "yes cancel please"));
    console.log("\n--- S7 cancel PENDING ---\n" + rec.log.join("\n"));
    expect(rec.replies[0]).toContain("cancelled, no charge");
    expect(rec.cancelled).toEqual([{ id: "b2", reason: "plans changed" }]);
    expect(rec.escalations).toContainEqual({ type: "cancellation", priority: "p2" });
  });

  it("S8 cancel at COMPLETED — refuses, offers complaint", async () => {
    rec.bookingLookup = { latest: { id: "b3", status: "COMPLETED" }, latestActive: null, activeCount: 0 };
    scriptToolCall("cancel_booking", { reason: "too late", patient_acknowledged_fee: true });
    await processWebhook(envelope(PATIENT, "cancel it"));
    console.log("\n--- S8 cancel COMPLETED ---\n" + rec.log.join("\n"));
    expect(rec.replies[0]).toContain("already complete");
    expect(rec.replies[0]).toContain("complaint");
    expect(rec.cancelled).toHaveLength(0);
  });

  it("S9 complaint (billing, medium) — logged, p2, 4h SLA", async () => {
    rec.bookingLookup = { latest: { id: "b4", status: "COMPLETED" }, latestActive: null, activeCount: 0 };
    scriptToolCall("log_complaint", { category: "billing", narrative: "I was charged twice for one visit", severity: "medium" });
    await processWebhook(envelope(PATIENT, "you billed me twice"));
    console.log("\n--- S9 complaint billing ---\n" + rec.log.join("\n"));
    expect(rec.replies[0]).toContain("4 hours");
    expect(rec.complaints[0]).toMatchObject({ category: "billing", bookingId: "b4", severity: "medium" });
    expect(rec.escalations).toContainEqual({ type: "complaint", priority: "p2" });
  });

  it("S10 complaint (safety, high) — escalates p1", async () => {
    rec.bookingLookup = { latest: { id: "b5", status: "COMPLETED" }, latestActive: null, activeCount: 0 };
    scriptToolCall("log_complaint", { category: "medic_behavior", narrative: "the medic was rough and hurt my mother", severity: "high" });
    await processWebhook(envelope(PATIENT, "the medic hurt my mother"));
    console.log("\n--- S10 complaint high ---\n" + rec.log.join("\n"));
    expect(rec.complaints[0]).toMatchObject({ category: "medic_behavior", severity: "high" });
    expect(rec.escalations).toContainEqual({ type: "complaint", priority: "p1" });
  });

  // ---- Slice 2a §2: aarogya_lead_alert {{5}} bracket-tag --------------
  // {{5}} is bodyParams[4] (the Context slot). cancel_booking and
  // log_complaint prefix it with an originating-tool tag so ops triages
  // at a glance; escalate_to_ops (genuine leads) stays raw.
  it("S11 cancel — {{5}} starts [CANCELLATION] Reason: and carries booking_code", async () => {
    rec.bookingLookup = {
      latest: { id: "b6", booking_code: "SAN-B-00058", status: "PENDING", service_category: "homecare" },
      latestActive: { id: "b6", booking_code: "SAN-B-00058", status: "PENDING", service_category: "homecare" },
      activeCount: 1,
    };
    scriptToolCall("cancel_booking", { reason: "plans changed", patient_acknowledged_fee: true });
    await processWebhook(envelope(PATIENT, "yes cancel please"));
    console.log("\n--- S11 cancel {{5}} ---\n" + rec.log.join("\n"));
    const t = rec.templateSends.find((x) => x.templateName === "aarogya_lead_alert");
    expect(t).toBeTruthy();
    const ctx = t!.bodyParams[4];
    expect(ctx.startsWith("[CANCELLATION] Reason:")).toBe(true);
    expect(ctx).toContain("plans changed");
    expect(ctx).toContain("| Booking #SAN-B-00058");
  });

  it("S12 complaint (billing) — {{5}} starts [COMPLAINT — billing] + narrative + code", async () => {
    rec.bookingLookup = {
      latest: { id: "b7", booking_code: "SAN-B-00071", status: "COMPLETED" },
      latestActive: null,
      activeCount: 0,
    };
    scriptToolCall("log_complaint", { category: "billing", narrative: "charged twice for one visit", severity: "medium" });
    await processWebhook(envelope(PATIENT, "you billed me twice"));
    console.log("\n--- S12 complaint {{5}} ---\n" + rec.log.join("\n"));
    const t = rec.templateSends.find((x) => x.templateName === "aarogya_lead_alert");
    const ctx = t!.bodyParams[4];
    expect(ctx.startsWith("[COMPLAINT — billing]")).toBe(true);
    expect(ctx).toContain("charged twice for one visit");
    expect(ctx).toContain("| Booking #SAN-B-00071");
  });

  it("S13 complaint (medic_behavior, high) — {{5}} tagged + escalation p1", async () => {
    rec.bookingLookup = {
      latest: { id: "b8", booking_code: "SAN-B-00072", status: "COMPLETED" },
      latestActive: null,
      activeCount: 0,
    };
    scriptToolCall("log_complaint", { category: "medic_behavior", narrative: "medic was rough with my mother", severity: "high" });
    await processWebhook(envelope(PATIENT, "the medic hurt my mother"));
    console.log("\n--- S13 complaint high {{5}} ---\n" + rec.log.join("\n"));
    const t = rec.templateSends.find((x) => x.templateName === "aarogya_lead_alert");
    expect(t!.bodyParams[4].startsWith("[COMPLAINT — medic_behavior]")).toBe(true);
    expect(rec.escalations).toContainEqual({ type: "complaint", priority: "p1" });
  });

  it("S14 qualified lead — {{5}} is raw context, NO bracket-tag (regression guard)", async () => {
    rec.scripted.push({
      text: "Thank you. A Medic will reach you within 30 minutes; the exact amount is settled at the door.",
      toolUses: [
        {
          id: "tu_14",
          name: "escalate_to_ops",
          input: {
            escalation_type: "qualified_lead",
            service_intent: "doctor_visit",
            urgency: "today",
            patient_name: "Mrs Sushma Sharma",
            patient_age: "68 y",
            patient_relationship: "parent",
            location: "Greater Kailash 1, New Delhi",
            context: "post knee surgery, needs home assessment",
            summary_for_ops: "68F GK-1, post knee surgery, Home Visit today",
          },
        },
      ],
      stopReason: "tool_use",
      model: "claude-sonnet-4-6",
      tokensIn: 1800,
      tokensOut: 140,
    });
    await processWebhook(envelope(PATIENT, "mother needs a home visit today, GK-1"));
    console.log("\n--- S14 lead {{5}} raw ---\n" + rec.log.join("\n"));
    const t = rec.templateSends.find((x) => x.templateName === "aarogya_lead_alert");
    const ctx = t!.bodyParams[4];
    expect(ctx).toBe("post knee surgery, needs home assessment");
    expect(ctx.startsWith("[")).toBe(false);
  });

  it("S15 cancel with no resolvable booking_code — suffix omitted, never 'undefined'", async () => {
    rec.bookingLookup = {
      latest: { id: "b9", booking_code: null, status: "CONFIRMED", service_category: "homecare" },
      latestActive: { id: "b9", booking_code: null, status: "CONFIRMED", service_category: "homecare" },
      activeCount: 1,
    };
    scriptToolCall("cancel_booking", { reason: "changed mind", patient_acknowledged_fee: true });
    await processWebhook(envelope(PATIENT, "cancel please"));
    console.log("\n--- S15 cancel no-code ---\n" + rec.log.join("\n"));
    const t = rec.templateSends.find((x) => x.templateName === "aarogya_lead_alert");
    const ctx = t!.bodyParams[4];
    expect(ctx.startsWith("[CANCELLATION] Reason:")).toBe(true);
    expect(ctx).not.toContain("undefined");
    expect(ctx).not.toContain("Booking #");
  });
});
