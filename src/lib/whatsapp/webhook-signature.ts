// HMAC SHA-256 verification for inbound WhatsApp Cloud API webhooks.
//
// Meta signs every webhook POST with the app secret and sends the digest in
// the `X-Hub-Signature-256: sha256=<hex>` header. We recompute the HMAC over
// the EXACT raw request body and compare in constant time (safety rule #2).
//
// Critical: the digest must be computed over the raw bytes Meta sent, not over
// a re-serialised JSON object — JSON.stringify(JSON.parse(body)) can differ
// byte-for-byte (key order, whitespace, unicode escaping) and would fail an
// otherwise-valid signature. The route reads `await req.text()` and passes it
// here untouched.

import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-hub-signature-256";

export type SignatureResult =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * Verify the X-Hub-Signature-256 header against the raw body.
 *
 * @param rawBody  The exact request body string (req.text()), unparsed.
 * @param signatureHeader  Value of the X-Hub-Signature-256 header.
 * @param appSecret  WHATSAPP_APP_SECRET.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  appSecret: string | undefined,
): SignatureResult {
  if (!appSecret) {
    // Misconfiguration, not an attack — but we must never accept unsigned
    // traffic, so this is still a rejection.
    return { valid: false, reason: "app_secret_not_configured" };
  }
  if (!signatureHeader) {
    return { valid: false, reason: "missing_signature_header" };
  }

  const [scheme, providedHex] = signatureHeader.split("=");
  if (scheme !== "sha256" || !providedHex) {
    return { valid: false, reason: "malformed_signature_header" };
  }

  const expectedHex = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");

  // Constant-time compare. timingSafeEqual throws on length mismatch, so guard
  // first — a length difference is itself a non-match.
  const providedBuf = Buffer.from(providedHex, "hex");
  const expectedBuf = Buffer.from(expectedHex, "hex");
  if (providedBuf.length !== expectedBuf.length) {
    return { valid: false, reason: "signature_mismatch" };
  }
  if (!timingSafeEqual(providedBuf, expectedBuf)) {
    return { valid: false, reason: "signature_mismatch" };
  }

  return { valid: true };
}
