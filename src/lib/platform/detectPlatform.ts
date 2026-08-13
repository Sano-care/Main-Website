// Client-side platform detection for the "Download App" hero CTA.
//
// The Pulse app is an Android-only APK, so the CTA must be honest about
// what a visitor can actually install:
//   - android  → real download link to /download/pulse
//   - ios      → muted "coming soon" (never a dead download)
//   - desktop  → QR so the visitor scans it on their phone
//
// Pure + signal-driven so it can be unit-tested without a DOM. The
// component reads the signals from `navigator` after mount.

export type ClientPlatform = "android" | "ios" | "desktop";

export interface PlatformSignals {
  /** navigator.userAgent */
  userAgent: string;
  /** navigator.maxTouchPoints — used to unmask iPadOS 13+ (see below) */
  maxTouchPoints?: number;
}

/**
 * Resolve the visitor's platform from navigator signals.
 *
 * Order matters: Android UAs also contain "Linux", and iPadOS 13+ reports a
 * desktop-Safari "Macintosh" UA, so the Mac+touch check has to come after the
 * explicit mobile checks.
 */
export function detectClientPlatform(signals: PlatformSignals): ClientPlatform {
  const ua = signals.userAgent ?? "";

  // Android phones and tablets.
  if (/android/i.test(ua)) return "android";

  // Classic iOS UA (iPhone / iPod, and iPad before iPadOS 13).
  if (/iphone|ipod|ipad/i.test(ua)) return "ios";

  // iPadOS 13+ masquerades as desktop Safari on "Macintosh". A real Mac has no
  // touchscreen, so Macintosh + multi-touch reliably means an iPad.
  if (/macintosh|mac os x/i.test(ua) && (signals.maxTouchPoints ?? 0) > 1) {
    return "ios";
  }

  // Windows, Linux desktop, real Macs, bots, everything else → QR.
  return "desktop";
}
