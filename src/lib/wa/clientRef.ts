// Client-side half of the WhatsApp click-attribution pipeline.
//
// NO "server-only" here — this is imported by client components. It only reads
// what GclidCapture persisted (first-party cookie + localStorage mirror) and
// decorates WhatsApp hrefs; it never talks to the DB.

import { useSyncExternalStore } from "react";

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
 * Pure href builder given an explicit ref (null = untracked). When a ref is
 * present, the link carries a prefilled message with `[ref: SC-XXXXXX]` so the
 * inbound handler can re-attach the gclid; untracked visitors get the plain
 * chat link (or whatever prefill the CTA already had) — we never fabricate a
 * token, and we never change the human-readable prefill.
 */
export function buildWaHrefFromRef(
  message?: string | null,
  ref?: string | null,
): string {
  const base = (message ?? "").trim();

  if (!ref) {
    return base
      ? `${WHATSAPP_DEEPLINK}?text=${encodeURIComponent(base)}`
      : WHATSAPP_DEEPLINK;
  }

  const text = base || DEFAULT_BOOKING_MESSAGE;
  return `${WHATSAPP_DEEPLINK}?text=${encodeURIComponent(`${text} [ref: ${ref}]`)}`;
}

/**
 * Build a WhatsApp href, reading the stored ref at call time. Safe to call from
 * an already-mounted client context (e.g. after a `mounted` guard). For a
 * persistent CTA that renders during SSR, prefer the `useWaHref` hook so the
 * initial render matches the server and can't cause a hydration mismatch.
 */
export function buildWaHref(message?: string | null): string {
  return buildWaHrefFromRef(message, readWaRef());
}

const noopSubscribe = () => () => {};

/**
 * Hydration-safe read of the stored ref: null on the server AND on the first
 * client (hydration) render, then the real `SC-XXXXXX` after mount. Backed by
 * useSyncExternalStore so it never triggers a setState-in-effect.
 */
export function useWaRef(): string | null {
  return useSyncExternalStore(noopSubscribe, readWaRef, () => null);
}

/** Hydration-safe wa.me href for a persistent client CTA. */
export function useWaHref(message?: string | null): string {
  return buildWaHrefFromRef(message, useWaRef());
}
