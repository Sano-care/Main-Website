"use client";

// Homepage "app companion" band — a dedicated section (not a hero button)
// promoting the Pulse Android app. Restyle + reposition of the former
// HeroAppDownloadCta; ALL the platform logic is unchanged.
//
// Same band, two responsive shapes, platform-aware in the CTA slot only:
//   mobile  → stacked card: icon + New pill, headline, sub, full-width button.
//   desktop → horizontal band: copy left, framed QR right.
//
// CTA slot (Android-only app, honest per platform):
//   Android → filled brand-blue "Download the app" → /download/pulse (APK).
//   iOS     → muted "iOS app — coming soon" (never a dead download).
//   Desktop → framed QR encoding https://sanocare.in/download/pulse.
//
// Platform is read via useSyncExternalStore (null server snapshot → no
// hydration mismatch, no synchronous setState); SSR renders an invisible
// space-reserving CTA so there is no layout shift on mobile.

import Image from "next/image";
import { useSyncExternalStore } from "react";
import { Download } from "lucide-react";

import { detectClientPlatform, type ClientPlatform } from "@/lib/platform/detectPlatform";

const DOWNLOAD_HREF = "/download/pulse";
const QR_SRC = "/qr/pulse-download.svg";
const APP_ICON_SRC = "/pulse-app-icon.svg";

const subscribe = () => () => {};
const getServerPlatform = (): ClientPlatform | null => null;
const getClientPlatform = (): ClientPlatform =>
  detectClientPlatform({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  });

function fireDownloadEvent(platform: "android" | "desktop_qr") {
  if (typeof window === "undefined") return;
  // dataLayer is globally declared by @next/third-parties; fired before
  // navigation (no preventDefault) so GTM captures it ahead of the redirect.
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ event: "app_download_click", platform });
}

// Filled brand-blue primary — white on #2B81FF (passes AA), min-h-[48px],
// full-width on mobile, visible focus ring.
const FILLED_CTA =
  "inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl " +
  "bg-primary px-6 text-[15px] font-semibold text-white transition-colors " +
  "hover:bg-primary-dark outline-none focus-visible:ring-2 focus-visible:ring-primary " +
  "focus-visible:ring-offset-2 sm:w-auto";

function CtaSlot({ platform }: { platform: ClientPlatform | null }) {
  // Pre-resolve: invisible placeholder sized like the button + caption so the
  // server/first-client render match (no hydration warning) and mobile has no
  // layout shift when the real state lands.
  if (platform === null) {
    return (
      <div className="min-h-[68px] w-full sm:w-auto" aria-hidden="true">
        <span className={`${FILLED_CTA} pointer-events-none opacity-0`}>
          <Download className="h-5 w-5" />
          Download the app
        </span>
      </div>
    );
  }

  if (platform === "android") {
    return (
      <div className="w-full sm:w-auto">
        <a
          href={DOWNLOAD_HREF}
          onClick={() => fireDownloadEvent("android")}
          className={FILLED_CTA}
          data-testid="app-band-android"
        >
          <Download className="h-5 w-5" aria-hidden="true" />
          Download the app
        </a>
        <p className="mt-2 text-center text-xs text-text-secondary sm:text-left">
          Free · Android
        </p>
      </div>
    );
  }

  if (platform === "ios") {
    return (
      <span
        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-text-secondary"
        data-testid="app-band-ios"
      >
        {/* Filled dot, not an app-store glyph — we don't imply a listing yet. */}
        <span className="size-1.5 rounded-full bg-slate-400" aria-hidden="true" />
        iOS app — coming soon
      </span>
    );
  }

  // desktop / other → framed QR tile (0.5px border, white bg, 12px radius).
  return (
    <div className="flex items-center gap-4" data-testid="app-band-desktop">
      <a
        href={DOWNLOAD_HREF}
        onClick={() => fireDownloadEvent("desktop_qr")}
        aria-label="Download the Sanocare Pulse Android app"
        className="shrink-0 rounded-[12px] border border-slate-200 bg-white p-2.5 outline-none transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        style={{ borderWidth: "0.5px" }}
      >
        <Image
          src={QR_SRC}
          alt="QR code linking to the Sanocare Pulse Android app download"
          width={104}
          height={104}
          className="h-[104px] w-[104px]"
          unoptimized
        />
      </a>
      <p className="text-sm font-medium text-text-main">Scan with your phone</p>
    </div>
  );
}

export function AppDownloadBand() {
  const platform = useSyncExternalStore(subscribe, getClientPlatform, getServerPlatform);

  return (
    <section aria-labelledby="app-download-heading" className="mt-4 mb-8 lg:my-6">
      {/* Card — white surface, hairline border, no gradient / heavy shadow
          ("we are not a fintech"). */}
      <div
        className="rounded-2xl border border-slate-200 bg-white p-6 lg:p-8"
        style={{ borderWidth: "0.5px" }}
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
          {/* Copy */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Image
                src={APP_ICON_SRC}
                alt="Sanocare Pulse app icon"
                width={48}
                height={48}
                className="h-12 w-12 rounded-[12px]"
                unoptimized
              />
              {/* One accent, per brand — a single coral "New" pill. */}
              <span className="inline-flex items-center rounded-full bg-accent-coral-50 px-2.5 py-1 text-[11px] font-bold tracking-wide text-[color:var(--color-accent-coral-dark)]">
                New
              </span>
            </div>
            <div>
              <h2
                id="app-download-heading"
                className="text-[22px] font-bold leading-tight tracking-[-0.4px] text-text-main lg:text-[26px]"
              >
                Your family&rsquo;s health, in one app
              </h2>
              <p className="mt-2 max-w-md text-[15px] leading-relaxed text-text-secondary">
                Book doctors, track everyone&rsquo;s records, and manage care
                &mdash; for the people you love.
              </p>
            </div>
          </div>

          {/* CTA slot — platform-aware */}
          <div className="lg:shrink-0">
            <CtaSlot platform={platform} />
          </div>
        </div>
      </div>
    </section>
  );
}
