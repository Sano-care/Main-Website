// Negative-guard regression suite for PR #162 (TEST-ONLY — no behavior change).
//
// LOCKS the founder's invariant: the payment-link + exact-pay capability is
// scoped to Medic-at-Home ONLY. The guard is STRUCTURAL — the only pay-link
// tool is start_medic_booking (Medic-at-Home cart), and the composed patient
// prompt grants the "send a payment link / quote an exact price" exception to
// that flow alone; every other service stays door-collect + ranges. These
// assertions fail if a future tool or knowledge-base edit silently reopens it.
//
// Why structural (not scripted agent-sim): the agent-sim harness STUBS
// generateResponse with scripted tool_use, so "the model won't call
// start_medic_booking for teleconsult" can't be asserted there without
// scripting the answer (tautology). The real, non-tautological guard is the
// tool exposure + composed-prompt text the model actually sees — asserted here,
// the same pattern as medicPromptComposition.test.ts / systemPrompt.test.ts.

import { describe, expect, it } from "vitest";

import { buildAarogyaSystemPrompt } from "@/lib/agent/knowledge";
import { getSystemPromptForTurn } from "@/lib/agent/config";
import {
  AAROGYA_TOOLS,
  AAROGYA_LAB_TOOLS,
  AAROGYA_MEDIC_CART_TOOLS,
  AAROGYA_PULSE_TOOLS,
  AAROGYA_CAREHUB_TOOLS,
  AAROGYA_MEDIC_TOOLS,
  AAROGYA_OPS_TOOLS,
  SEARCH_MEDIC_PROCEDURES,
  QUOTE_MEDIC_CART,
  START_MEDIC_BOOKING,
  SEARCH_LAB_TESTS,
  type ToolSchema,
} from "@/lib/agent/tools";
import type { Identity } from "@/lib/whatsapp/identity";

const KB = buildAarogyaSystemPrompt();
const ctx = { patient_name: null, last_booking: null, carehub: null, language: null };
const newcomer: Identity = { role: "new" };
// Every tool a patient could ever be shown, across sub-roles.
const ALL_PATIENT_TOOLS: ToolSchema[] = [
  ...AAROGYA_TOOLS,
  ...AAROGYA_LAB_TOOLS,
  ...AAROGYA_MEDIC_CART_TOOLS,
  ...AAROGYA_PULSE_TOOLS,
  ...AAROGYA_CAREHUB_TOOLS,
];

// ── Tool-schema invariants (what the model is actually offered) ──────────────

describe("pay-link capability is a single, Medic-at-Home-scoped tool", () => {
  it("start_medic_booking is the ONLY patient tool whose schema mentions a payment link", () => {
    const linkTools = ALL_PATIENT_TOOLS.filter((t) =>
      /payment link/i.test(t.description),
    ).map((t) => t.name);
    expect(linkTools).toEqual(["start_medic_booking"]);
  });

  it("quote_medic_cart is the ONLY patient tool advertising an EXACT server price", () => {
    const exactTools = ALL_PATIENT_TOOLS.filter((t) =>
      /exact/i.test(t.description),
    ).map((t) => t.name);
    // The pay-link tool (start_medic_booking) re-prices server-side too, but only
    // quote_medic_cart's schema advertises an exact figure — no other SERVICE
    // tool does. (start_medic_booking is uniquely the payment-link tool, above.)
    expect(exactTools).toEqual(["quote_medic_cart"]);
  });

  it("the medic-cart tools are exactly the 3 expected, and are patient-only", () => {
    expect(AAROGYA_MEDIC_CART_TOOLS).toEqual([
      SEARCH_MEDIC_PROCEDURES,
      QUOTE_MEDIC_CART,
      START_MEDIC_BOOKING,
    ]);
    // Withheld from medic + ops role sets (never advertised outside patients).
    const medicNames = new Set(AAROGYA_MEDIC_TOOLS.map((t) => t.name));
    const opsNames = new Set(AAROGYA_OPS_TOOLS.map((t) => t.name));
    for (const t of AAROGYA_MEDIC_CART_TOOLS) {
      expect(medicNames.has(t.name)).toBe(false);
      expect(opsNames.has(t.name)).toBe(false);
    }
  });

  it("no non-medic patient tool can take payment or an exact amount (booking is escalate-only)", () => {
    // The general patient tools + lab tool never carry a price/payment field.
    const nonMedic = [...AAROGYA_TOOLS, ...AAROGYA_LAB_TOOLS];
    for (const t of nonMedic) {
      const props = Object.keys(t.input_schema.properties);
      expect(props).not.toContain("payment_mode");
      expect(props).not.toContain("amount");
      expect(props).not.toContain("price");
    }
  });
});

// ── Knowledge-base invariants (what the model is told) ───────────────────────

describe("KB grants the pay-link / exact-price exception to Medic-at-Home ONLY", () => {
  it("the composed patient prompt carries the Medic-at-Home cart flow + RECEIPT RULE", () => {
    const prompt = getSystemPromptForTurn(newcomer, ctx);
    expect(prompt).toContain("Medic-at-Home cart");
    expect(prompt).toContain("search_medic_procedures");
    expect(prompt).toContain("quote_medic_cart");
    expect(prompt).toContain("start_medic_booking");
    expect(prompt).toContain("RECEIPT RULE");
    // receipt-only: booking only on the cleared webhook, never on a claim.
    expect(prompt).toMatch(/only when the payment actually clears/i);
  });

  it("EVERY 'payment link' mention in the KB is Medic-at-Home-scoped or a prohibition", () => {
    const offending = KB.split("\n").filter(
      (line) =>
        /payment link/i.test(line) &&
        !/medic-at-home|start_medic_booking|\bonly\b|\bexcept|\bnever\b/i.test(line),
    );
    // A future edit that affirmatively grants a link to another service (e.g.
    // "send the patient a payment link for their teleconsult") would land here.
    expect(offending).toEqual([]);
  });

  it("the exact-price + pay-link EXCEPTION is explicitly named + bound to start_medic_booking", () => {
    expect(KB).toContain("The ONE exception is the Medic-at-Home cart");
    expect(KB).toMatch(/EXCEPT the exact amount quote_medic_cart \/ start_medic_booking compute/i);
  });
});

// ── Per-service scenario locks (the brief's 5, expressed structurally) ───────

describe("scenario locks — non-Medic services stay door-collect + ranges", () => {
  it("(1) Teleconsult: ranges-only (₹399 onwards), no payment link in its section", () => {
    expect(KB).toContain("₹399 onwards");
    // The teleconsult catalog section itself must not grant a link/pay-now.
    const teleSection = KB.slice(
      KB.indexOf("## 4. Teleconsultation"),
      KB.indexOf("## 4. Teleconsultation") + 400,
    );
    expect(teleSection).not.toMatch(/payment link|pay now/i);
  });

  it("(2) Home Visit: ranges-only (₹499 onwards), no payment link in its section", () => {
    expect(KB).toContain("₹499 onwards");
    const hvSection = KB.slice(
      KB.indexOf("## 1. Home Visit"),
      KB.indexOf("## 1. Home Visit") + 400,
    );
    expect(hvSection).not.toMatch(/payment link|pay now/i);
  });

  it("(3) Home nursing by the hour → normal Home Nursing + escalate_to_ops, door-collect", () => {
    expect(KB).toContain("₹199 onwards");
    // The medic-cart section explicitly deflects open-ended hourly nursing back
    // to the door-collect escalate flow (so it can't be pulled into a link).
    expect(KB).toMatch(
      /open-ended "home nursing by the hour" need that isn't a specific procedure, use the normal Home Nursing qualify \+ escalate_to_ops flow/i,
    );
  });

  it("(4) Lab: catalogue price allowed (search_lab_tests) but no pay-now / final total", () => {
    // Catalogue lookup is permitted…
    expect(SEARCH_LAB_TESTS.name).toBe("search_lab_tests");
    expect(/read-only/i.test(SEARCH_LAB_TESTS.description)).toBe(true);
    expect(/never books/i.test(SEARCH_LAB_TESTS.description)).toBe(true);
    // …but the lab section promises no total and no link.
    expect(KB).toMatch(/confirmed at booking/i);
    expect(KB).toMatch(/don't promise a total/i);
  });

  it("(5) positive control — the Medic-at-Home path is intact + patient-exposed", () => {
    // Tools exist and are patient-scoped (guarded above); the flow copy is live.
    expect(KB).toMatch(/search_medic_procedures[\s\S]*quote_medic_cart[\s\S]*start_medic_booking/);
    // And the exact-price exception keeps the flow usable (not neutralised).
    expect(QUOTE_MEDIC_CART.description).toMatch(/exact/i);
    expect(START_MEDIC_BOOKING.description).toMatch(/payment link/i);
  });
});
