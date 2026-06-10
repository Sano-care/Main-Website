import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  firstName,
  getBookingLabel,
  getBookingNextStep,
  getServiceLabel,
  serviceCategoryToSlug,
} from "./labels";
import {
  formatCollectionDate,
  labTimeWindowFromDate,
  sendBookingConfirmed,
  sendLabCollectionScheduled,
  sendVisitComplete,
} from "./rampwin";

// ── Helpers ─────────────────────────────────────────────────────────

/** Pull the parsed Rampwin request body out of the mocked fetch call. */
function lastFetchBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("fetch was not called");
  return JSON.parse((call[1] as RequestInit).body as string);
}

function okFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: { messageId: "m_1" } }),
  });
}

// ── Label helpers ───────────────────────────────────────────────────

describe("label helpers", () => {
  it("getBookingLabel carries the Booking suffix per service", () => {
    expect(getBookingLabel("home-visit")).toBe("Home Visit Booking");
    expect(getBookingLabel("teleconsultation")).toBe("Teleconsultation Booking");
    expect(getBookingLabel("medic-at-home")).toBe("Medic at Home Booking");
    expect(getBookingLabel("lab-tests")).toBe("Lab Tests Booking");
  });

  it("getServiceLabel drops the suffix", () => {
    expect(getServiceLabel("home-visit")).toBe("Home Visit");
    expect(getServiceLabel("medic-at-home")).toBe("Medic at Home");
    expect(getServiceLabel("lab-tests")).toBe("Lab Tests");
  });

  it("getBookingNextStep is service-specific (home+medic share)", () => {
    expect(getBookingNextStep("home-visit")).toBe(
      "Your Medic and doctor will be assigned shortly.",
    );
    expect(getBookingNextStep("medic-at-home")).toBe(
      "Your Medic and doctor will be assigned shortly.",
    );
    expect(getBookingNextStep("teleconsultation")).toContain("video link");
    expect(getBookingNextStep("lab-tests")).toBe(
      "Your phlebotomist slot will be confirmed shortly.",
    );
  });

  it("serviceCategoryToSlug normalizes legacy + T85 + falls back", () => {
    expect(serviceCategoryToSlug("lab-tests")).toBe("lab-tests");
    expect(serviceCategoryToSlug("diagnostics")).toBe("lab-tests");
    expect(serviceCategoryToSlug("homecare")).toBe("home-visit");
    expect(serviceCategoryToSlug("teleconsult")).toBe("teleconsultation");
    expect(serviceCategoryToSlug("chronic")).toBe("home-visit"); // fallback
    expect(serviceCategoryToSlug(null)).toBe("home-visit"); // fallback
  });

  it("firstName takes the first token, falls back to 'there'", () => {
    expect(firstName("Asha Sharma")).toBe("Asha");
    expect(firstName("  Ravi   Kumar ")).toBe("Ravi");
    expect(firstName("")).toBe("there");
    expect(firstName(null)).toBe("there");
  });
});

// ── Date / window helpers ───────────────────────────────────────────

describe("collection date + window formatting (IST)", () => {
  const now = new Date("2026-06-09T12:00:00Z"); // 17:30 IST, Jun 9

  it("formats a tomorrow slot as 'Tomorrow, <Month Day>'", () => {
    const slot = new Date("2026-06-10T04:00:00Z"); // 09:30 IST, Jun 10
    expect(formatCollectionDate(slot, now)).toBe("Tomorrow, June 10");
  });

  it("formats a non-tomorrow slot as '<Month Day, Year>'", () => {
    const slot = new Date("2026-06-15T04:00:00Z"); // Jun 15 IST
    expect(formatCollectionDate(slot, now)).toBe("June 15, 2026");
  });

  it("derives the window from the IST hour", () => {
    expect(labTimeWindowFromDate(new Date("2026-06-10T04:00:00Z"))).toBe(
      "7-10 AM",
    ); // 09:30 IST
    expect(labTimeWindowFromDate(new Date("2026-06-10T13:00:00Z"))).toBe(
      "5-8 PM",
    ); // 18:30 IST
  });
});

// ── Senders ─────────────────────────────────────────────────────────

describe("Rampwin patient senders", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.RAMPWIN_API_KEY = "test-key";
    process.env.RAMPWIN_CHANNEL_ID = "test-channel";
    delete process.env.RAMPWIN_API_URL;
    delete process.env.RAMPWIN_BOOKING_CONFIRMED_ENABLED;
    delete process.env.RAMPWIN_VISIT_COMPLETE_ENABLED;
    delete process.env.RAMPWIN_LAB_COLLECTION_ENABLED;
    fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sendBookingConfirmed (home visit) builds the 4-var payload", async () => {
    const res = await sendBookingConfirmed({
      patientName: "Asha Sharma",
      serviceSlug: "home-visit",
      bookingCode: "SAN-B-00058",
      patientPhone: "+919999988888",
    });

    expect(res.delivered).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = lastFetchBody(fetchMock);
    expect(body.template.name).toBe("sanocare_booking_confirmed");
    expect(body.phone_number).toBe("919999988888");
    const texts = body.template.components[0].parameters.map(
      (p: { text: string }) => p.text,
    );
    expect(texts).toEqual([
      "Asha",
      "Home Visit Booking",
      "SAN-B-00058",
      "Your Medic and doctor will be assigned shortly.",
    ]);
  });

  it("sendBookingConfirmed (lab) uses the lab label + lab next-step", async () => {
    await sendBookingConfirmed({
      patientName: "Ravi",
      serviceSlug: "lab-tests",
      bookingCode: "SAN-B-00099",
      patientPhone: "9999988888", // bare 10-digit
    });

    const body = lastFetchBody(fetchMock);
    expect(body.phone_number).toBe("919999988888"); // normalized
    const texts = body.template.components[0].parameters.map(
      (p: { text: string }) => p.text,
    );
    expect(texts[1]).toBe("Lab Tests Booking");
    expect(texts[3]).toBe("Your phlebotomist slot will be confirmed shortly.");
  });

  it("sendVisitComplete sends the 2-var (no-suffix) payload", async () => {
    const res = await sendVisitComplete({
      patientName: "Asha Sharma",
      serviceSlug: "home-visit",
      patientPhone: "+919999988888",
    });

    expect(res.delivered).toBe(true);
    const body = lastFetchBody(fetchMock);
    expect(body.template.name).toBe("aarogya_visit_complete");
    const texts = body.template.components[0].parameters.map(
      (p: { text: string }) => p.text,
    );
    expect(texts).toEqual(["Asha", "Home Visit"]);
  });

  it("sendLabCollectionScheduled builds the 4-var payload", async () => {
    const res = await sendLabCollectionScheduled({
      patientName: "Asha Sharma",
      phlebotomistName: "Rahul Verma",
      scheduledFor: new Date("2026-06-10T04:00:00Z"), // 09:30 IST
      timeWindow: "7-10 AM",
      patientPhone: "+919999988888",
      now: new Date("2026-06-09T12:00:00Z"),
    });

    expect(res.delivered).toBe(true);
    const body = lastFetchBody(fetchMock);
    expect(body.template.name).toBe("sanocare_lab_collection_scheduled");
    const texts = body.template.components[0].parameters.map(
      (p: { text: string }) => p.text,
    );
    expect(texts).toEqual([
      "Asha",
      "Rahul Verma",
      "Tomorrow, June 10",
      "7-10 AM",
    ]);
  });

  it("returns delivered=false on a non-2xx Rampwin response", async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false, message: "boom" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendVisitComplete({
      patientName: "Asha",
      serviceSlug: "home-visit",
      patientPhone: "+919999988888",
    });
    expect(res.delivered).toBe(false);
  });

  it("returns delivered=false when success flag is missing (2xx but not success:true)", async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}), // empty body — the rampwin.ts false-502 shape
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendBookingConfirmed({
      patientName: "Asha",
      serviceSlug: "home-visit",
      bookingCode: "SAN-B-1",
      patientPhone: "+919999988888",
    });
    expect(res.delivered).toBe(false);
  });

  it("no-ops (no fetch) when the per-template ENABLED flag is false", async () => {
    process.env.RAMPWIN_VISIT_COMPLETE_ENABLED = "false";
    const res = await sendVisitComplete({
      patientName: "Asha",
      serviceSlug: "home-visit",
      patientPhone: "+919999988888",
    });
    expect(res.delivered).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws + returns delivered=false on a network error", async () => {
    fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendBookingConfirmed({
      patientName: "Asha",
      serviceSlug: "home-visit",
      bookingCode: "SAN-B-1",
      patientPhone: "+919999988888",
    });
    expect(res.delivered).toBe(false);
  });

  it("rejects a malformed phone without calling fetch", async () => {
    const res = await sendVisitComplete({
      patientName: "Asha",
      serviceSlug: "home-visit",
      patientPhone: "12345", // too short
    });
    expect(res.delivered).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
