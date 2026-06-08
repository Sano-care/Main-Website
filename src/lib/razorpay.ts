// Server-side Razorpay client.
// Never import this from client components — it uses the secret key.

import Razorpay from "razorpay";
import crypto from "crypto";

const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;

if (!keyId || !keySecret) {
  // We don't throw at import time so that build succeeds in environments
  // without keys configured. Endpoints will return 500 if invoked without
  // the env vars set.
  // eslint-disable-next-line no-console
  console.warn(
    "[razorpay] NEXT_PUBLIC_RAZORPAY_KEY_ID and/or RAZORPAY_KEY_SECRET are not set. Razorpay endpoints will fail until both are configured in Netlify env vars."
  );
}

let _client: Razorpay | null = null;

export function getRazorpayClient(): Razorpay {
  if (!keyId || !keySecret) {
    throw new Error(
      "Razorpay keys not configured. Set NEXT_PUBLIC_RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET."
    );
  }
  if (!_client) {
    _client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
  return _client;
}

/**
 * Verify the Razorpay payment signature.
 *
 * Razorpay returns three values after a successful checkout:
 *  - razorpay_payment_id
 *  - razorpay_order_id
 *  - razorpay_signature
 *
 * The signature is HMAC-SHA256 of `order_id|payment_id` using the key secret.
 * We must verify this server-side before trusting the payment.
 */
export function verifyPaymentSignature(args: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  if (!keySecret) return false;
  const { orderId, paymentId, signature } = args;
  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  // Constant-time comparison to avoid timing leaks
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(signature, "utf8")
  );
}

/**
 * Sanocare's pricing constants in paise (Razorpay always uses paise).
 * Mirrors src/constants/pricing.ts but here as integers for the gateway.
 */
export const RAZORPAY_AMOUNTS = {
  // @deprecated T85 PR5 — legacy flat ₹249 booking fee. Still used by
  // /api/razorpay/create-order's legacy mode (no t85Slug) which is hit
  // by Navbar's no-slug "Book a Visit" pill via the @deprecated
  // BookingModal. New service-led flows compute amount server-side
  // via getServiceHalfRoundedUp(t85ToPricingKey(slug)). Retires when
  // Navbar's pill is repointed.
  BOOKING_FEE_PAISE: 24_900,
  // @deprecated T85 PR5 — legacy full-upfront option. Same caveat.
  FULL_VISIT_PAISE: 49_900,
  // ₹250 balance auto-charged at case close
  BALANCE_PAISE: 25_000,
  // Nursing-only entry
  NURSING_MIN_PAISE: 19_900,
  // Teleconsult entry
  TELECONSULT_MIN_PAISE: 39_900,
  // Night surge
  NIGHT_VISIT_PAISE: 79_900,
} as const;
