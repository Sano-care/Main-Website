// Slice 4a C6 — getSystemPromptForTurn composition tests.

import { describe, it, expect } from "vitest";

import { getSystemPromptForTurn } from "@/lib/agent/config";
import {
  CUSTOMER_REGISTERED_ADDENDUM,
  LANGUAGE_MIRROR_RULE,
  OPS_MODE_ADDENDUM,
  SHORT_MESSAGE_RULE,
} from "@/lib/agent/knowledge";

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
});
