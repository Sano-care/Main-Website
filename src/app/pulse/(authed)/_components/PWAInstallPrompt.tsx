"use client";

import { useEffect, useState } from "react";
import { Smartphone, X, Share } from "lucide-react";

import { getSessionCount } from "../_lib/sessionCount";

/**
 * T90 Slice 2 Step 16 — PWA install prompt (Surface 7).
 *
 * Inline card at the bottom of the /pulse home zone stack. Two
 * variants based on browser capabilities:
 *
 *   - 'chrome' (Chrome / Edge Android, desktop Chrome): listens for
 *     the `beforeinstallprompt` event, stashes it, and on tap calls
 *     `deferredPrompt.prompt()` to trigger the native install dialog.
 *   - 'ios' (iOS Safari, iOS Chrome — both WebKit-backed, no install
 *     API): renders manual "tap share → Add to Home Screen" steps.
 *
 * Eligibility gate (all must be true):
 *   - NOT already installed (display-mode standalone OR
 *     navigator.standalone)
 *   - getSessionCount() >= 2 (won't show on first session ever —
 *     brief explicit "no" + builds engagement before nudging)
 *   - NOT recently dismissed (within 7 days — pulse_install_prompt_
 *     dismissed_at localStorage key)
 *   - iOS path: shows immediately on eligible iOS browsers
 *   - Chrome path: waits for beforeinstallprompt to fire
 *
 * Hydration safety (matches Step 10 EmergencyRibbon pattern):
 *   - Server render + first paint: null
 *   - useEffect on mount: read browser APIs, set variant accordingly
 *
 * Dismissal:
 *   - Tapping "Maybe later" / "Got it" / X → mark dismissed + hide
 *   - Chrome: tapping "Add to home screen" → call prompt(), await
 *     userChoice, mark dismissed REGARDLESS of accept/dismiss
 *     outcome (founder push-back L — accepted user shouldn't see a
 *     flash of the card during the brief window before
 *     display-mode flips)
 *
 * Edge case (founder push-back M): if beforeinstallprompt already
 * fired before this component mounted (rare — user lingered on
 * /pulse/login or /pulse/welcome long enough for Chrome's
 * heuristics), we miss it. Pragmatic ship: listener-on-mount
 * catches ~95% of cases. If UAT shows reliable misses, promote
 * the listener to PulseChrome's useEffect with a window-global
 * stash (Google PWA docs pattern).
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "pulse_install_prompt_dismissed_at";
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_SESSIONS = 2;

type Variant = "hidden" | "chrome" | "ios";

export default function PWAInstallPrompt() {
  const [variant, setVariant] = useState<Variant>("hidden");
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Hydration safe — abort on server.
    if (typeof window === "undefined") return;

    // Already installed? Done.
    if (isStandalone()) return;

    // Session-count gate (founder Surface 7 spec — never on first session).
    if (getSessionCount() < MIN_SESSIONS) return;

    // Cooldown gate.
    if (recentlyDismissed()) return;

    // iOS path — show manual instructions immediately. Both iOS Safari
    // and iOS Chrome (CriOS) end up here because both use WebKit and
    // neither supports beforeinstallprompt.
    if (isIOSLike()) {
      setVariant("ios");
      return;
    }

    // Chrome / Edge / etc. path — wait for beforeinstallprompt to fire.
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVariant("chrome");
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  function markDismissed() {
    try {
      window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      // localStorage failure (private mode, quota, security policy) —
      // swallow. User sees the card again next eligible session;
      // acceptable degraded UX.
    }
    setVariant("hidden");
  }

  async function handleChromeInstall() {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      // Founder push-back L: treat both 'accepted' and 'dismissed' as
      // dismiss. Acceptance → Chrome installs natively; we mark
      // dismissed so the card doesn't briefly flash before display-mode
      // standalone flips on the next session. Dismissal → explicit opt-
      // out → cooldown applies.
      await deferredPrompt.userChoice;
    } catch (err) {
      console.error("[PWAInstallPrompt] prompt() failed", err);
    }
    markDismissed();
  }

  if (variant === "hidden") return null;

  if (variant === "ios") {
    return (
      <section
        aria-label="Install Sanocare Pulse"
        className="relative rounded-2xl border border-primary/20 bg-primary-50 p-5"
      >
        <button
          type="button"
          onClick={markDismissed}
          aria-label="Dismiss install prompt"
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full text-text-secondary hover:bg-white/60"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-white">
            <Smartphone className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-text-main">
              Add Pulse to your home screen
            </h3>
            <ol className="mt-2 space-y-1.5 text-sm text-text-secondary">
              <li>
                <span className="font-semibold text-text-main">1.</span> Tap
                the share icon{" "}
                <Share
                  className="inline-block h-3.5 w-3.5 align-text-bottom text-text-main [stroke-width:1.8]"
                  aria-hidden="true"
                />{" "}
                at the bottom of your screen
              </li>
              <li>
                <span className="font-semibold text-text-main">2.</span>{" "}
                Scroll down and tap{" "}
                <span className="font-semibold text-text-main">
                  Add to Home Screen
                </span>
              </li>
              <li>
                <span className="font-semibold text-text-main">3.</span> Tap{" "}
                <span className="font-semibold text-text-main">Add</span> —
                you&apos;ll find Pulse on your home screen
              </li>
            </ol>
            <div className="mt-4">
              <button
                type="button"
                onClick={markDismissed}
                className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-primary/20 hover:opacity-90"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // 'chrome' — Chrome / Edge / desktop Chrome / Android Chrome.
  return (
    <section
      aria-label="Install Sanocare Pulse"
      className="relative rounded-2xl border border-primary/20 bg-primary-50 p-5"
    >
      <button
        type="button"
        onClick={markDismissed}
        aria-label="Dismiss install prompt"
        className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full text-text-secondary hover:bg-white/60"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-white">
          <Smartphone className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-text-main">
            Add Pulse to your home screen
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            Open Sanocare in one tap, like a normal app. No app store, no
            download — instant.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleChromeInstall}
              className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-primary/20 hover:opacity-90"
            >
              Add to home screen
            </button>
            <button
              type="button"
              onClick={markDismissed}
              className="inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-sm font-medium text-text-secondary hover:bg-white/60"
            >
              Maybe later
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ====== helpers =====================================================

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari uses a non-standard navigator.standalone boolean.
  const navStandalone = (navigator as Navigator & { standalone?: boolean })
    .standalone;
  return navStandalone === true;
}

function isIOSLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // Standard iPhone / iPad / iPod UAs.
  if (
    /iPad|iPhone|iPod/.test(ua) &&
    !(window as Window & { MSStream?: unknown }).MSStream
  ) {
    return true;
  }
  // iPadOS 13+: defaults to desktop-Safari UA (Macintosh). Distinguish
  // via maxTouchPoints — a Mac never reports >1, an iPad always does
  // (multi-touch capacitive screen). Real share of caregiver
  // demographic — shared family iPad — would silently see no prompt
  // without this branch (founder push-back K).
  if (ua.includes("Macintosh") && navigator.maxTouchPoints > 1) {
    return true;
  }
  return false;
}

function recentlyDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.localStorage.getItem(DISMISSED_KEY);
    if (!stored) return false;
    const parsed = parseInt(stored, 10);
    if (!Number.isFinite(parsed)) return false;
    return Date.now() - parsed < COOLDOWN_MS;
  } catch {
    // localStorage exception — fail open (don't suppress the prompt).
    return false;
  }
}
