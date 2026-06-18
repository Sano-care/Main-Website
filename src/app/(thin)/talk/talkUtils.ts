// Pure helpers for the /talk landing page.
//
// Split out of TalkClient so we can unit-test the URL and dataLayer payload
// shapes in the existing node-env vitest harness (no jsdom, no RTL needed).
// The component-level "renders without throwing / no Navbar / no JSON-LD"
// assertions still need a browser to be meaningful — those are caught by
// visual QA against the Netlify preview, not by these tests.

import { WHATSAPP_DEEPLINK } from "@/lib/contact";

/** Default warm message — no service-specific claim that could be over-promised. */
export const DEFAULT_WA_MESSAGE = "Hi Sanocare — I would like to know more.";

/**
 * Build the wa.me URL with a prefilled message.
 *
 * `prefilledMsg` wins if non-empty (after trim); otherwise falls back to
 * DEFAULT_WA_MESSAGE. Uses `encodeURIComponent` (NOT URLSearchParams) so spaces
 * encode as `%20` rather than `+` — WhatsApp's link handlers on iOS/Android
 * render `+` as a literal plus sign in the prefilled text, not as a space.
 * Matches the encoding used by src/lib/wa/conversion.ts (/wa route).
 */
export function buildWaUrl(prefilledMsg?: string | null): string {
  const text = (prefilledMsg ?? "").trim() || DEFAULT_WA_MESSAGE;
  return `${WHATSAPP_DEEPLINK}?text=${encodeURIComponent(text)}`;
}

export interface DataLayerPayloadInput {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  gclid?: string | null;
}

export interface DataLayerPayload {
  event: "whatsapp_click";
  source: "talk_page";
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
  gclid: string;
}

/**
 * Build the dataLayer payload fired on WhatsApp-button click. All UTM/gclid
 * fields collapse missing values to empty strings — GTM's downstream
 * triggers can match on "is not empty" cleanly without `undefined` vs `null`
 * vs `""` ambiguity.
 */
export function buildDataLayerPayload(
  input: DataLayerPayloadInput,
): DataLayerPayload {
  return {
    event: "whatsapp_click",
    source: "talk_page",
    utm_source: input.utm_source ?? "",
    utm_medium: input.utm_medium ?? "",
    utm_campaign: input.utm_campaign ?? "",
    utm_term: input.utm_term ?? "",
    utm_content: input.utm_content ?? "",
    gclid: input.gclid ?? "",
  };
}
