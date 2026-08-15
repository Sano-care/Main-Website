"use client";

// Frozen lead slide (slide 0) of the hero-right carousel — a brand-blue app
// card that shows a live launch countdown until 4:30 PM IST, then flips to the
// platform-aware Pulse download. Fills the carousel frame (h-full).
//
// Gating is identical to #156's band: pre-launch renders NO /download/pulse
// link (the tick store's server snapshot is null, so the link is never in the
// SSR HTML and only mounts client-side after launch). Both stores use
// useSyncExternalStore → no setState-in-effect, no hydration mismatch.

import Image from "next/image";
import { useSyncExternalStore } from "react";
import { Download, Lock } from "lucide-react";

import { detectClientPlatform, type ClientPlatform } from "@/lib/platform/detectPlatform";
import {
  LAUNCH_TARGET_MS,
  remainingSecondsAt,
  countdownParts,
  pad2,
} from "@/lib/launch/countdown";

const DOWNLOAD_HREF = "/download/pulse";
const QR_SRC = "/qr/pulse-download.svg";
const APP_ICON_SRC = "/pulse-app-icon.svg";

const subscribePlatform = () => () => {};
const getServerPlatform = (): ClientPlatform | null => null;
const getClientPlatform = (): ClientPlatform =>
  detectClientPlatform({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  });

const subscribeTick = (onChange: () => void) => {
  const id = setInterval(onChange, 1000);
  return () => clearInterval(id);
};
const getRemaining = (): number => remainingSecondsAt(LAUNCH_TARGET_MS, Date.now());
const getServerRemaining = (): number | null => null;

function fireDownloadEvent(platform: "android" | "desktop_qr") {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ event: "app_download_click", platform });
}

export function HeroAppSlide() {
  const platform = useSyncExternalStore(subscribePlatform, getClientPlatform, getServerPlatform);
  const remaining = useSyncExternalStore(subscribeTick, getRemaining, getServerRemaining);
  const launched = remaining === 0;

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#2B81FF] to-[#1647A1] px-6 py-6 text-center text-white sm:gap-4"
      data-testid="hero-app-slide"
    >
      <div className="flex items-center gap-2.5">
        <Image
          src={APP_ICON_SRC}
          alt="Sanocare Pulse app icon"
          width={40}
          height={40}
          className="h-10 w-10 rounded-[10px] ring-1 ring-white/25"
          unoptimized
        />
        <span className="text-lg font-bold tracking-tight">Sanocare Pulse</span>
      </div>

      {launched ? <DownloadState platform={platform} /> : <CountdownState remaining={remaining} />}
    </div>
  );
}

function CountdownState({ remaining }: { remaining: number | null }) {
  const parts = remaining === null ? null : countdownParts(remaining);
  return (
    <>
      <p className="max-w-xs text-sm text-white/90">
        Your family&rsquo;s health, in one app — goes live at 4:30 PM
      </p>
      <div
        className="font-mono text-3xl font-extrabold tabular-nums tracking-tight sm:text-4xl"
        aria-label="Time until Sanocare Pulse launches"
      >
        {parts ? `${pad2(parts.hh)}:${pad2(parts.mm)}:${pad2(parts.ss)}` : "‒‒:‒‒:‒‒"}
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white ring-1 ring-white/25">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
        Available at launch
      </span>
    </>
  );
}

function DownloadState({ platform }: { platform: ClientPlatform | null }) {
  // Pre-resolve: invisible reserved space so there's no layout shift on the card.
  if (platform === null) {
    return <div className="min-h-[64px]" aria-hidden="true" />;
  }

  if (platform === "android") {
    return (
      <>
        <p className="text-sm text-white/90">Your family&rsquo;s health, in one app.</p>
        <a
          href={DOWNLOAD_HREF}
          onClick={() => fireDownloadEvent("android")}
          className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-white px-6 text-[15px] font-semibold text-primary outline-none transition-colors hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white"
          data-testid="hero-app-android"
        >
          <Download className="h-5 w-5" aria-hidden="true" />
          Download the app
        </a>
        <span className="text-xs text-white/80">Free · Android</span>
      </>
    );
  }

  if (platform === "ios") {
    return (
      <>
        <p className="text-sm text-white/90">Your family&rsquo;s health, in one app.</p>
        <span
          className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2.5 text-sm font-medium text-white ring-1 ring-white/25"
          data-testid="hero-app-ios"
        >
          <span className="size-1.5 rounded-full bg-white/70" aria-hidden="true" />
          iOS app — coming soon
        </span>
      </>
    );
  }

  // desktop / other → framed QR tile on the blue card.
  return (
    <div className="flex items-center gap-3" data-testid="hero-app-desktop">
      <a
        href={DOWNLOAD_HREF}
        onClick={() => fireDownloadEvent("desktop_qr")}
        aria-label="Download the Sanocare Pulse Android app"
        className="shrink-0 rounded-[12px] bg-white p-2 outline-none transition-transform hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-white"
      >
        <Image
          src={QR_SRC}
          alt="QR code linking to the Sanocare Pulse Android app download"
          width={92}
          height={92}
          className="h-[92px] w-[92px]"
          unoptimized
        />
      </a>
      <div className="text-left text-sm text-white/90">
        <p className="font-semibold text-white">Get it on Android</p>
        <p>Scan with your phone.</p>
      </div>
    </div>
  );
}
