// Medic Help-Mode Part 1 — prompt composition + tool exposure.

import { describe, expect, it } from "vitest";
import { getSystemPromptForTurn } from "@/lib/agent/config";
import { MEDIC_ADDENDUM } from "@/lib/agent/knowledge";
import {
  AAROGYA_MEDIC_TOOLS,
  AAROGYA_TOOLS,
  ESCALATE_TO_DOCTOR,
  FETCH_BOOKING_CONTEXT,
  LOG_MEDIC_QUERY,
} from "@/lib/agent/tools";
import type { Identity } from "@/lib/whatsapp/identity";

const ctx = { patient_name: null, last_booking: null };
const medic: Identity = { role: "medic", medicId: "m1", fullName: "Asha Devi" };
const newcomer: Identity = { role: "new" };

describe("getSystemPromptForTurn — medic mode", () => {
  it("includes the MEDIC_ADDENDUM for a medic", () => {
    const prompt = getSystemPromptForTurn(medic, ctx);
    expect(prompt).toContain(MEDIC_ADDENDUM);
    expect(prompt).toContain("MEDIC MODE");
  });

  it("does NOT push the patient context block for a medic (early return)", () => {
    const prompt = getSystemPromptForTurn(medic, {
      patient_name: "Ravi Patient",
      last_booking: null,
    });
    // The patient's name would only appear via renderContextBlock, which medic
    // mode skips. So a medic turn never carries patient context.
    expect(prompt).not.toContain("Ravi Patient");
  });

  it("does NOT include the MEDIC_ADDENDUM for a non-medic", () => {
    const prompt = getSystemPromptForTurn(newcomer, ctx);
    expect(prompt).not.toContain(MEDIC_ADDENDUM);
  });
});

describe("medic tool exposure", () => {
  it("AAROGYA_MEDIC_TOOLS is exactly the three medic tools", () => {
    expect(AAROGYA_MEDIC_TOOLS).toEqual([
      ESCALATE_TO_DOCTOR,
      FETCH_BOOKING_CONTEXT,
      LOG_MEDIC_QUERY,
    ]);
  });

  it("medic tools are disjoint from the patient tool set", () => {
    const patientNames = new Set(AAROGYA_TOOLS.map((t) => t.name));
    for (const t of AAROGYA_MEDIC_TOOLS) {
      expect(patientNames.has(t.name)).toBe(false);
    }
  });

  it("the patient tool set carries none of the medic tools", () => {
    const medicNames = new Set(AAROGYA_MEDIC_TOOLS.map((t) => t.name));
    for (const t of AAROGYA_TOOLS) {
      expect(medicNames.has(t.name)).toBe(false);
    }
  });
});
