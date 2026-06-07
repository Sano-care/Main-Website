"use client";

// T85 PR4a — body scroll lock for modal overlays.
//
// Bug 2 from preview-38 UAT: scrolling within ServiceLedBookingModal
// also scrolled the homepage behind it. Pre-existing code used
// `document.body.style.overflow = 'hidden'`, which is known-broken on
// iOS Safari — rubber-band scroll still bleeds through. The robust
// pattern is `position: fixed; top: -{scrollY}px; width: 100%`. When
// the lock releases, we restore the original styles AND scroll the
// window back to the captured scrollY so the patient lands exactly
// where they were before the modal opened.
//
// Ref counting:
//   Multiple components can call useScrollLock(true) concurrently
//   (e.g. BookingGate briefly overlaps with the modal during the
//   gate→verify→modal handoff). The first lock captures scrollY +
//   applies styles; the last release restores. Module-level state
//   keeps this simple — no provider, no context.
//
// Strict-mode safe: useEffect double-runs in dev mode trigger
// acquire→release→acquire. The captured scrollY is the same across
// both acquires, and the synchronous restore in the cleanup before
// the second mount means the user sees no flash.
//
// Server-safe: all DOM access is inside the effect (never at module
// scope), so this file is safe to import from server components that
// render client children. The hook itself does nothing during SSR
// because `useEffect` doesn't run there.

import { useEffect } from "react";

let lockCount = 0;
let capturedScrollY = 0;
let originalStyles: {
  position: string;
  top: string;
  width: string;
} | null = null;

function acquire(): void {
  if (lockCount === 0) {
    capturedScrollY = window.scrollY;
    originalStyles = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    document.body.style.position = "fixed";
    document.body.style.top = `-${capturedScrollY}px`;
    document.body.style.width = "100%";
  }
  lockCount += 1;
}

function release(): void {
  // Math.max guards against any caller releasing more than once. In
  // normal React lifecycle this shouldn't happen, but defensive code
  // is cheap and the alternative (negative count blocking a later
  // restore) would be hard to debug.
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0 && originalStyles) {
    document.body.style.position = originalStyles.position;
    document.body.style.top = originalStyles.top;
    document.body.style.width = originalStyles.width;
    originalStyles = null;
    // Restore scroll position synchronously so the patient lands
    // exactly where they were before the modal opened. Without this,
    // closing the modal would teleport them back to the top.
    window.scrollTo(0, capturedScrollY);
  }
}

/**
 * Lock body scroll while `isLocked === true`. Releases automatically
 * on unmount or when `isLocked` flips false. Safe to call from
 * multiple components simultaneously — internal ref counting handles
 * overlap.
 */
export function useScrollLock(isLocked: boolean): void {
  useEffect(() => {
    if (!isLocked) return;
    acquire();
    return () => {
      release();
    };
  }, [isLocked]);
}
