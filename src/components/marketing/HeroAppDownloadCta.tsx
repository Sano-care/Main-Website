"use client";

// Homepage hero — secondary "Download App" CTA (platform-aware).
//
// The Pulse app is an Android-only APK served at /download/pulse. This CTA is
// honest about what each visitor can install:
//   - Android  → "Download Android App" outline link → /download/pulse (APK)
//   - iOS      → muted "coming soon" label (never a dead download)
//   - Desktop  → QR encoding https://sanocare.in/download/pulse, "scan on phone"
//
// Platform is detected from navigator AFTER mount; the SSR/first-render output
// is a neutral, invisible placeholder sized like the button so there is no
// hydration mismatch and no layout shift on mobile (the primary target) when
// the real state resolves. Mirrors the `!mounted` guard in FloatingWhatsApp.
//
// Secondary weight (outline, brand blue) so it never competes with the filled
// coral Book CTAs elsewhere on the page. Reuses the same tokens as Button.tsx's
// `variant="outline"`, on an <a> because a real download needs an anchor.

import Image from "next/image";
import { useSyncExternalStore } from "react";
import { Download } from "lucide-react";

import { detectClientPlatform, type ClientPlatform } from "@/lib/platform/detectPlatform";

const DOWNLOAD_HREF = "/download/pulse";
const QR_SRC = "/qr/pulse-download.svg";

// Read the client-only platform via useSyncExternalStore so the value is null
// during SSR + the first (hydrating) client render — matching the server HTML,
// so no hydration mismatch — then resolves to the real platform right after.
// This is the effect-free equivalent of the FloatingWhatsApp `!mounted` guard;
// no synchronous setState, so no cascading render.
const subscribe = () => () => {};
const getServerPlatform = (): ClientPlatform | null => null;
const getClientPlatform = (): ClientPlatform =>
  detectClientPlatform({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  });

// Outline / secondary CTA — border-primary text-primary, fills on hover.
// min-h-[44px] guarantees the tap target regardless of text metrics.
const OUTLINE_CTA =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border " +
  "border-primary px-6 py-3 text-sm font-bold text-primary transition-colors " +
  "hover:bg-primary hover:text-white outline-none focus-visible:ring-2 " +
  "focus-visible:ring-primary focus-visible:ring-offset-2";

function fireDownloadEvent(platform: "android" | "desktop_qr") {
  if (typeof window === "undefined") return;
  // dataLayer is globally declared by @next/third-parties; mirror the push
  // pattern used in TalkClient. Fired before navigation (no preventDefault),
  // so GTM captures it ahead of the APK redirect.
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ event: "app_download_click", platform });
}

export function HeroAppDownloadCta() {
  const platform = useSyncExternalStore(subscribe, getClientPlatform, getServerPlatform);

  // Pre-mount: invisible but space-reserving placeholder (matches on server +
  // first client render → no hydration warning; min-h-[44px] → no mobile CLS).
  if (platform === null) {
    return (
      <div className="min-h-[44px]" aria-hidden="true">
        <span className={`${OUTLINE_CTA} pointer-events-none opacity-0`}>
          <Download className="h-4 w-4" aria-hidden="true" />
          Download Android App
        </span>
      </div>
    );
  }

  if (platform === "android") {
    return (
      <div className="min-h-[44px]">
        <a
          href={DOWNLOAD_HREF}
          onClick={() => fireDownloadEvent("android")}
          className={OUTLINE_CTA}
          data-testid="hero-download-android"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Download Android App
        </a>
      </div>
    );
  }

  if (platform === "ios") {
    return (
      <div className="flex min-h-[44px] items-center">
        <span
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-text-secondary"
          data-testid="hero-download-ios"
        >
          {/* Filled dot instead of an app-store glyph — we don't imply an
              App Store listing that doesn't exist yet. */}
          <span className="size-1.5 rounded-full bg-slate-400" aria-hidden="true" />
          iOS app — coming soon
        </span>
      </div>
    );
  }

  // desktop / other → scannable QR (fixed URL, pre-generated static asset).
  return (
    <div className="flex items-center gap-4" data-testid="hero-download-desktop">
      <a
        href={DOWNLOAD_HREF}
        onClick={() => fireDownloadEvent("desktop_qr")}
        aria-label="Download the Sanocare Pulse Android app"
        className="shrink-0 rounded-xl border border-slate-200 bg-white p-2 outline-none transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <Image
          src={QR_SRC}
          alt="QR code linking to the Sanocare Pulse Android app download"
          width={96}
          height={96}
          className="h-24 w-24"
          unoptimized
        />
      </a>
      <div className="text-sm leading-snug text-text-secondary">
        <p className="font-semibold text-text-main">Get the app on Android</p>
        <p>Scan to install on your phone.</p>
      </div>
    </div>
  );
}
