import "server-only";

import { createHash } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Google Ads offline conversion upload — STUB (founder wires the Ads side).
//
// `whatsapp_click_paid` is an offline-conversion-import (UPLOAD_CLICKS) action
// that has never received an upload, so the bidder is blind to the ~70% of
// bookings that close over WhatsApp. This module is the seam: the Razorpay
// verify-success path calls uploadWhatsappConversion() whenever a paid booking
// carries a gclid.
//
// >>> HANDOFF: implement the body of uploadWhatsappConversion() against
// >>> POST customers/{customerId}/conversionUploads:uploadClickConversions
// >>> with: gclid, conversionAction (whatsapp_click_paid resource name),
// >>> conversionDateTime (formatGoogleAdsDateTime — Google requires
// >>> "yyyy-mm-dd hh:mm:ss+05:30"), conversionValue, currencyCode "INR".
// >>> Either call the Ads API directly here, or POST to the signed internal
// >>> endpoint / MCP tool (gads_upload_offline_conversion) — the call site
// >>> does not care, it only needs this signature to keep holding.
// ─────────────────────────────────────────────────────────────────────────────

/** The Google Ads conversion action this pipeline feeds. */
export const WHATSAPP_CONVERSION_ACTION = "whatsapp_click_paid";

/** Env flag — the whole upload stays dark until credentials are confirmed. */
export const GADS_UPLOAD_FLAG = "GADS_WA_CONV_UPLOAD_ENABLED";

export interface UploadWhatsappConversionInput {
  /** Google click id captured at landing and carried through WhatsApp. */
  gclid: string;
  /** Order value in rupees (not paise) — Google wants a decimal amount. */
  valueInr: number;
  /** When the conversion happened (payment capture time). */
  occurredAt: Date;
}

export interface UploadWhatsappConversionResult {
  uploaded: boolean;
  /** Why nothing was sent — "disabled" when the env flag is off. */
  reason?: string;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Google Ads requires conversion_date_time as `yyyy-mm-dd hh:mm:ss+|-hh:mm`.
 * We always emit IST (+05:30) since the business operates in Asia/Kolkata.
 */
export function formatGoogleAdsDateTime(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())} ` +
    `${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}:${p(ist.getUTCSeconds())}+05:30`
  );
}

/**
 * Upload one paid-WhatsApp-booking conversion to Google Ads.
 *
 * Contract for the call site (already wired in /api/razorpay/verify):
 *   - Returns `{ uploaded: false, reason: "disabled" }` when the env flag is off
 *     (the default) — a silent, expected no-op.
 *   - THROWS when the flag is on but the Ads call fails or is unimplemented, so
 *     the caller's catch logs WA_CONV_UPLOAD_FAILED loudly.
 * Never called on the happy path unless a gclid is present.
 */
export async function uploadWhatsappConversion(
  input: UploadWhatsappConversionInput,
): Promise<UploadWhatsappConversionResult> {
  if (process.env[GADS_UPLOAD_FLAG] !== "true") {
    return { uploaded: false, reason: "disabled" };
  }

  // TODO(founder / Ads side): replace this throw with the real upload.
  // Everything the API needs is already assembled:
  const _payload = {
    conversionAction: WHATSAPP_CONVERSION_ACTION,
    gclid: input.gclid,
    conversionDateTime: formatGoogleAdsDateTime(input.occurredAt),
    conversionValue: input.valueInr,
    currencyCode: "INR",
  };
  void _payload;

  throw new Error(
    `${GADS_UPLOAD_FLAG}=true but uploadWhatsappConversion() is not wired to the Google Ads API yet`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Conversions for Leads (ECL) — SECOND PR, scaffold only.
//
// Paid WhatsApp bookings with no gclid (organic / direct / returning) can still
// be matched by Google if we upload a SHA-256 of the normalized phone number.
// The hashing helper lands here now so the follow-up PR only has to add the
// upload call; nothing calls it yet.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize an Indian phone to E.164 (+91XXXXXXXXXX), lowercase + trim, then
 * SHA-256 hex — the format Google expects for enhanced-conversion user data.
 * Returns null when the input can't be normalized to a 10-digit Indian number.
 *
 * TODO(next PR): call this from the verify path for paid bookings with no gclid
 * and upload via uploadClickConversions' user_identifiers (hashed_phone_number).
 */
export function hashPhoneE164(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;

  // Accept 10-digit local, 91-prefixed, or 0-prefixed forms.
  let local: string;
  if (digits.length === 10) local = digits;
  else if (digits.length === 12 && digits.startsWith("91")) local = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) local = digits.slice(1);
  else return null;

  const e164 = `+91${local}`.trim().toLowerCase();
  return createHash("sha256").update(e164).digest("hex");
}
