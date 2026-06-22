// Slice 5b — pure helpers: flags, first-name fallback, IST month.

import { afterEach, describe, expect, it, vi } from "vitest";

// The helpers live alongside the sweeps, which import db.ts → supabase-server
// (createClient throws without env). Stub it so the module graph loads.
vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import {
  isCarehubOfferEnabled,
  isCarehubVisitReminderEnabled,
  CAREHUB_OFFER_FLAG,
  CAREHUB_VISIT_REMINDER_FLAG,
} from "@/lib/whatsapp/carehubFlags";
import { firstNameOrFallback } from "@/lib/whatsapp/carehubOutbound";
import { istYearMonth } from "@/lib/whatsapp/carehubReminder";

describe("carehub flags — OFF unless exactly 'true'", () => {
  it("offer flag", () => {
    expect(isCarehubOfferEnabled({})).toBe(false);
    expect(isCarehubOfferEnabled({ [CAREHUB_OFFER_FLAG]: "false" })).toBe(false);
    expect(isCarehubOfferEnabled({ [CAREHUB_OFFER_FLAG]: "1" })).toBe(false);
    expect(isCarehubOfferEnabled({ [CAREHUB_OFFER_FLAG]: "TRUE" })).toBe(false);
    expect(isCarehubOfferEnabled({ [CAREHUB_OFFER_FLAG]: "true" })).toBe(true);
  });
  it("visit reminder flag", () => {
    expect(isCarehubVisitReminderEnabled({})).toBe(false);
    expect(isCarehubVisitReminderEnabled({ [CAREHUB_VISIT_REMINDER_FLAG]: "true" })).toBe(true);
  });
});

describe("firstNameOrFallback", () => {
  it("takes the first token", () => {
    expect(firstNameOrFallback("Sonia Gupta")).toBe("Sonia");
    expect(firstNameOrFallback("  Aayushi   Shishodia ")).toBe("Aayushi");
  });
  it("falls back to 'there' for empty/nullish", () => {
    expect(firstNameOrFallback(null)).toBe("there");
    expect(firstNameOrFallback(undefined)).toBe("there");
    expect(firstNameOrFallback("   ")).toBe("there");
  });
});

describe("istYearMonth — IST calendar month YYYYMM", () => {
  it("is the IST month even when UTC is the previous month", () => {
    // 30 Jun 18:30:00Z == 1 Jul 00:00 IST → July.
    expect(istYearMonth(new Date("2026-06-30T18:30:00Z"))).toBe("202607");
    // 30 Jun 18:29:59Z == 30 Jun 23:59:59 IST → June.
    expect(istYearMonth(new Date("2026-06-30T18:29:59Z"))).toBe("202606");
  });
  it("midday is unambiguous", () => {
    expect(istYearMonth(new Date("2026-06-15T06:00:00Z"))).toBe("202606");
  });
});

afterEach(() => {
  // no global env mutated — flags read from injected env objects above
});
