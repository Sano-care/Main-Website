// Slice 4a C6 — getSystemPromptForTurn composition tests.

import { describe, it, expect } from "vitest";

import { getSystemPromptForTurn } from "@/lib/agent/config";
import {
  buildAarogyaSystemPrompt,
  CUSTOMER_CAREHUB_ADDENDUM,
  CUSTOMER_REGISTERED_ADDENDUM,
  LANGUAGE_MIRROR_RULE,
  MEDICATION_REMINDER_RULE,
  OPS_MODE_ADDENDUM,
  POST_BOOKING_COORDINATION_RULE,
  SHORT_MESSAGE_RULE,
} from "@/lib/agent/knowledge";

const recentBooking = {
  service_category: "home-visit",
  status: "PENDING",
  created_at: "2026-06-25T10:00:00Z",
};

const baseContext = {
  patient_name: null,
  last_booking: null,
  carehub: null as null,
  language: null,
};

describe("getSystemPromptForTurn — composition", () => {
  it("always includes the base prompt + language mirror + short message rule", () => {
    const prompt = getSystemPromptForTurn({ role: "new" }, baseContext);
    expect(prompt).toContain("You are Aarogya"); // base
    expect(prompt).toContain(LANGUAGE_MIRROR_RULE);
    expect(prompt).toContain(SHORT_MESSAGE_RULE);
    expect(prompt).toContain("PATIENT CONTEXT");
  });

  it("registered customer → CUSTOMER_REGISTERED_ADDENDUM is appended", () => {
    const prompt = getSystemPromptForTurn(
      { role: "customer", subRole: "registered", customerId: "cus-1", fullName: "Rajesh" },
      { ...baseContext, patient_name: "Rajesh" },
    );
    expect(prompt).toContain(CUSTOMER_REGISTERED_ADDENDUM);
    expect(prompt).toContain("Name: Rajesh");
  });

  it("new visitor → CUSTOMER_REGISTERED_ADDENDUM is NOT appended", () => {
    const prompt = getSystemPromptForTurn({ role: "new" }, baseContext);
    expect(prompt).not.toContain(CUSTOMER_REGISTERED_ADDENDUM);
  });

  it("customer with a recent last_booking → POST_BOOKING_COORDINATION_RULE appended (references booking, never invents)", () => {
    const prompt = getSystemPromptForTurn(
      { role: "customer", subRole: "registered", customerId: "cus-1" },
      { ...baseContext, last_booking: recentBooking },
    );
    expect(prompt).toContain(POST_BOOKING_COORDINATION_RULE);
    expect(prompt).toMatch(/get_booking_history/);
    expect(prompt).toMatch(/NEVER invent/i);
  });

  it("customer with NO last_booking → coordination rule absent", () => {
    const prompt = getSystemPromptForTurn(
      { role: "customer", subRole: "registered", customerId: "cus-1" },
      baseContext,
    );
    expect(prompt).not.toContain(POST_BOOKING_COORDINATION_RULE);
  });

  it("booking-history 'new' customer (no customers row) with last_booking → rule still applies", () => {
    const prompt = getSystemPromptForTurn(
      { role: "customer", subRole: "new" },
      { ...baseContext, last_booking: recentBooking },
    );
    expect(prompt).toContain(POST_BOOKING_COORDINATION_RULE);
  });

  it("registered customer → MEDICATION_REMINDER_RULE appended (can set reminders, store-only, never Google Assistant)", () => {
    const prompt = getSystemPromptForTurn(
      { role: "customer", subRole: "registered", customerId: "cus-1" },
      baseContext,
    );
    expect(prompt).toContain(MEDICATION_REMINDER_RULE);
    expect(prompt).toMatch(/log_medication/);
    expect(prompt).toMatch(/never.*google assistant/i);
    expect(prompt).toMatch(/teleconsult/i);
  });

  it("carehub customer → MEDICATION_REMINDER_RULE appended", () => {
    const prompt = getSystemPromptForTurn(
      { role: "customer", subRole: "carehub", customerId: "cus-2" },
      baseContext,
    );
    expect(prompt).toContain(MEDICATION_REMINDER_RULE);
  });

  it("new / unregistered sender → MEDICATION_REMINDER_RULE NOT appended (no account, no tool)", () => {
    expect(getSystemPromptForTurn({ role: "new" }, baseContext)).not.toContain(
      MEDICATION_REMINDER_RULE,
    );
    expect(
      getSystemPromptForTurn({ role: "customer", subRole: "new" }, baseContext),
    ).not.toContain(MEDICATION_REMINDER_RULE);
  });

  it("ops_founder → OPS_MODE_ADDENDUM + OPS MODE context block, NO PATIENT CONTEXT", () => {
    const prompt = getSystemPromptForTurn(
      { role: "ops_founder", phone: "+919760059900" },
      baseContext,
    );
    expect(prompt).toContain(OPS_MODE_ADDENDUM);
    expect(prompt).toContain("OPS MODE ACTIVE");
    // The renderContextBlock-specific marker — checks the actual context
    // block isn't emitted, not the substring "PATIENT CONTEXT" (which the
    // language mirror rule references by name).
    expect(prompt).not.toContain("do not mention explicitly");
  });

  it("ops_founder → MEDICATION_REMINDER_RULE now attached (the founder can set reminders)", () => {
    const prompt = getSystemPromptForTurn(
      { role: "ops_founder", phone: "+919760059900" },
      baseContext,
    );
    expect(prompt).toContain(MEDICATION_REMINDER_RULE);
  });

  it("the external-app ban is in the BASE prompt → present on every role's turn", () => {
    // Base prompt itself.
    const base = buildAarogyaSystemPrompt();
    expect(base).toMatch(/never suggest google calendar/i);
    expect(base).toMatch(/Sanocare Pulse/);
    // And therefore on every composed turn — patient, ops, medic, new.
    for (const identity of [
      { role: "new" } as const,
      { role: "customer", subRole: "registered", customerId: "c" } as const,
      { role: "ops_founder", phone: "+919760059900" } as const,
      { role: "medic", medicId: "m", fullName: "M" } as const,
    ]) {
      expect(getSystemPromptForTurn(identity, baseContext)).toMatch(
        /never suggest google calendar/i,
      );
    }
  });

  it("ops_founder with pending draft → context block surfaces the target phone", () => {
    const prompt = getSystemPromptForTurn(
      { role: "ops_founder", phone: "+919760059900" },
      baseContext,
      { pendingDraftTargetPhone: "+919876543210" },
    );
    expect(prompt).toContain("Pending draft to: +919876543210");
  });

  it("ops_founder with NO pending draft → 'No pending draft.' line", () => {
    const prompt = getSystemPromptForTurn(
      { role: "ops_founder", phone: "+919760059900" },
      baseContext,
    );
    expect(prompt).toContain("No pending draft.");
  });

  it("PATIENT CONTEXT renders last_booking when present", () => {
    const prompt = getSystemPromptForTurn(
      { role: "customer", subRole: "registered", customerId: "cus-1", fullName: "Asha" },
      {
        patient_name: "Asha",
        last_booking: { service_category: "homecare", status: "COMPLETED", created_at: "2026-06-10T09:00:00Z" },
        carehub: null,
        language: "hinglish",
      },
    );
    expect(prompt).toContain("Last booking: 2026-06-10 homecare, completed");
    expect(prompt).toContain("Current language: hinglish");
  });

  it("carehub: null does NOT render any 'CareHub' line (deferred to Slice 5)", () => {
    const prompt = getSystemPromptForTurn(
      { role: "customer", subRole: "registered", customerId: "cus-1" },
      baseContext,
    );
    expect(prompt).not.toMatch(/CareHub/);
  });

  it("doctor / medic → no addendums (Slice 4a is patient + ops only)", () => {
    const docPrompt = getSystemPromptForTurn(
      { role: "doctor", doctorId: "doc-1", fullName: "Dr Asha" },
      baseContext,
    );
    expect(docPrompt).not.toContain(CUSTOMER_REGISTERED_ADDENDUM);
    expect(docPrompt).not.toContain(OPS_MODE_ADDENDUM);
  });

  // --- Slice 5 — CareHub composition --------------------------------------

  it("carehub member → BOTH registered personalization AND CareHub addendum", () => {
    const prompt = getSystemPromptForTurn(
      { role: "customer", subRole: "carehub", customerId: "cus-care", fullName: "Meera" },
      {
        patient_name: "Meera",
        last_booking: null,
        carehub: { active: true, started_at: "2026-06-20T08:00:00Z", monthly_inr: 199 },
        language: null,
      },
    );
    expect(prompt).toContain(CUSTOMER_REGISTERED_ADDENDUM);
    expect(prompt).toContain(CUSTOMER_CAREHUB_ADDENDUM);
  });

  it("carehub context → PATIENT CONTEXT renders the member-since line", () => {
    const prompt = getSystemPromptForTurn(
      { role: "customer", subRole: "carehub", customerId: "cus-care", fullName: "Meera" },
      {
        patient_name: "Meera",
        last_booking: null,
        carehub: { active: true, started_at: "2026-06-20T08:00:00Z", monthly_inr: 199 },
        language: null,
      },
    );
    expect(prompt).toContain("CareHub member since 2026-06-20 (₹199/month)");
  });

  it("registered (non-carehub) member → CareHub addendum is NOT appended", () => {
    const prompt = getSystemPromptForTurn(
      { role: "customer", subRole: "registered", customerId: "cus-1", fullName: "Rajesh" },
      { ...baseContext, patient_name: "Rajesh" },
    );
    expect(prompt).not.toContain(CUSTOMER_CAREHUB_ADDENDUM);
  });
});
