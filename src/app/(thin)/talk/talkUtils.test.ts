import { describe, expect, it } from "vitest";

import {
  DEFAULT_WA_MESSAGE,
  buildDataLayerPayload,
  buildWaUrl,
} from "./talkUtils";

describe("buildWaUrl", () => {
  it("uses the default warm message when no prefill is given", () => {
    const url = buildWaUrl();
    expect(url).toMatch(/^https:\/\/wa\.me\/919711977782\?text=/);
    expect(decodeURIComponent(url.split("text=")[1]!)).toBe(DEFAULT_WA_MESSAGE);
  });

  it("honors a custom prefilled message", () => {
    const url = buildWaUrl("Hi Sanocare about home doctor");
    expect(decodeURIComponent(url.split("text=")[1]!)).toBe(
      "Hi Sanocare about home doctor",
    );
  });

  it("trims whitespace-only prefill back to the default", () => {
    expect(buildWaUrl("   ")).toBe(buildWaUrl());
    expect(buildWaUrl(null)).toBe(buildWaUrl());
    expect(buildWaUrl(undefined)).toBe(buildWaUrl());
  });

  it("URL-encodes special characters in the prefill", () => {
    const url = buildWaUrl("Hi & welcome — let's talk?");
    // URLSearchParams escapes &, spaces, ', and the em-dash.
    expect(url).toContain("text=");
    expect(url).not.toContain(" & ");
    expect(decodeURIComponent(url.split("text=")[1]!)).toBe(
      "Hi & welcome — let's talk?",
    );
  });

  it("always points at the Sanocare WhatsApp number from contact.ts", () => {
    // Guards against the deeplink constant being silently mutated.
    expect(buildWaUrl()).toContain("wa.me/919711977782");
  });
});

describe("buildDataLayerPayload", () => {
  it("emits the whatsapp_click event with talk_page source", () => {
    const payload = buildDataLayerPayload({});
    expect(payload.event).toBe("whatsapp_click");
    expect(payload.source).toBe("talk_page");
  });

  it("collapses missing UTM fields to empty strings (not undefined/null)", () => {
    const payload = buildDataLayerPayload({});
    expect(payload.utm_source).toBe("");
    expect(payload.utm_medium).toBe("");
    expect(payload.utm_campaign).toBe("");
    expect(payload.utm_term).toBe("");
    expect(payload.utm_content).toBe("");
    expect(payload.gclid).toBe("");
  });

  it("attaches UTM params verbatim when provided", () => {
    const payload = buildDataLayerPayload({
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "doctor-at-home-aggregation-v4",
      utm_term: "home doctor delhi",
      utm_content: "ad-variant-3",
      gclid: "abc123",
    });
    expect(payload.utm_source).toBe("google");
    expect(payload.utm_medium).toBe("cpc");
    expect(payload.utm_campaign).toBe("doctor-at-home-aggregation-v4");
    expect(payload.utm_term).toBe("home doctor delhi");
    expect(payload.utm_content).toBe("ad-variant-3");
    expect(payload.gclid).toBe("abc123");
  });

  it("treats null and undefined as empty (covers searchParams.get() returning null)", () => {
    const payload = buildDataLayerPayload({
      utm_source: null,
      utm_medium: undefined,
      utm_campaign: null,
    });
    expect(payload.utm_source).toBe("");
    expect(payload.utm_medium).toBe("");
    expect(payload.utm_campaign).toBe("");
  });
});
