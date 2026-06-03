// Mandatory integration test for HMAC webhook verification (handover:
// "Integration test for HMAC verification is mandatory").
//
// Exercises the exact path Meta uses: HMAC-SHA256 of the raw body with the app
// secret, hex-encoded, sent as "sha256=<hex>". Covers the happy path plus the
// rejection cases the route depends on (tampered body, wrong secret, missing /
// malformed header).

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "@/lib/whatsapp/webhook-signature";

const APP_SECRET = "test_app_secret_value_1234567890";

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "123", changes: [] }],
  });

  it("accepts a correctly signed body", () => {
    const sig = sign(body, APP_SECRET);
    expect(verifyWebhookSignature(body, sig, APP_SECRET)).toEqual({ valid: true });
  });

  it("rejects when the body was tampered with after signing", () => {
    const sig = sign(body, APP_SECRET);
    const tampered = body.replace("123", "456");
    const result = verifyWebhookSignature(tampered, sig, APP_SECRET);
    expect(result.valid).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    const sig = sign(body, "the_wrong_secret");
    const result = verifyWebhookSignature(body, sig, APP_SECRET);
    expect(result.valid).toBe(false);
  });

  it("rejects a missing signature header", () => {
    const result = verifyWebhookSignature(body, null, APP_SECRET);
    expect(result).toEqual({ valid: false, reason: "missing_signature_header" });
  });

  it("rejects a malformed signature header (no sha256= prefix)", () => {
    const result = verifyWebhookSignature(body, "deadbeef", APP_SECRET);
    expect(result).toEqual({ valid: false, reason: "malformed_signature_header" });
  });

  it("rejects when the app secret is not configured", () => {
    const sig = sign(body, APP_SECRET);
    const result = verifyWebhookSignature(body, sig, undefined);
    expect(result).toEqual({ valid: false, reason: "app_secret_not_configured" });
  });

  it("does not throw on a wrong-length hex digest", () => {
    // A short hex digest must compare false, never throw (timingSafeEqual
    // would otherwise throw on a length mismatch).
    const result = verifyWebhookSignature(body, "sha256=abcd", APP_SECRET);
    expect(result.valid).toBe(false);
  });
});
