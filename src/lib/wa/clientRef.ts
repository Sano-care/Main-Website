// Client-side half of the WhatsApp click-attribution pipeline.
//
// NO "server-only" here — this is imported by client components. It only reads
// what GclidCapture persisted (first-party cookie + localStorage mirror) and
// decorates WhatsApp hrefs; it never talks to the DB.

import { WHATSAPP_DEEPLINK } from "@/lib/contact";

export const GCLID_COOKIE = "sc_gclid";
export const WA_REF_COOKIE = "sc_wa_ref";
/** ~90 days — matches the Google Ads click-attribution window we care about. */
export const CLICK_COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

/** Default prefill when a tracked visitor taps a WhatsApp CTA. */
export const DEFAULT_BOOKING_MESSAGE = "Hi, I'd like to book.";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function readLocal(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null; // Safari private mode / storage disabled
  }
}

/** Cookie first (survives localStorage clears), then the localStorage mirror. */
export function readStored(name: string): string | null {
  return readCookie(name) ?? readLocal(name);
}

export function writeStored(name: string, value: string): void {
  try {
    document.cookie =
      `${name}=${encodeURIComponent(value)}; path=/; max-age=${CLICK_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
  } catch {
    /* ignore */
  }
  try {
    window.localStorage.setItem(name, value);
  } catch {
    /* ignore */
  }
}

/** The stored `SC-XXXXXX` handle, or null for untracked (organic) visitors. */
export function readWaRef(): string | null {
  return readStored(WA_REF_COOKIE);
}

/**
 * Build a WhatsApp href. When this visitor arrived from an ad (we hold a ref
 * token), the link carries a prefilled message with `[ref: SC-XXXXXX]` so the
 * inbound handler can re-attach the gclid. Untracked visitors get the plain
 * chat link — we never fabricate a token.
 */
export function buildWaHref(message?: string | null): string {
  const ref = readWaRef();
  const base = (message ?? "").trim();

  // Untracked (organic): keep whatever prefill the CTA already had — a CTA that
  // passes no message stays a plain chat. We never fabricate a token.
  if (!ref) {
    return base ? `${WHATSAPP_DEEPLINK}?text=${encodeURIComponent(base)}` : WHATSAPP_DEEPLINK;
  }

  const text = base || DEFAULT_BOOKING_MESSAGE;
  return `${WHATSAPP_DEEPLINK}?text=${encodeURIComponent(`${text} [ref: ${ref}]`)}`;
}
