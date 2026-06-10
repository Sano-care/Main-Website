"use client";

import { useEffect } from "react";

/**
 * T90 Pulse v1 Phase 1 — Service worker registration for the /pulse scope.
 *
 * Thin client component: registers /pulse-sw.js on first mount, soft-fails
 * (warn-only) on any registration error. Renders nothing.
 *
 * The service worker itself is registration-only in Phase 1 (no caching
 * strategy) — its presence enables the Add-to-Home-Screen install prompt
 * on Chrome/Edge by satisfying the installability criteria alongside
 * `/pulse-manifest.json`. Phase 2 may layer an offline-fallback strategy
 * for the /pulse home screen.
 *
 * Why scoped to /pulse: the SW file is served from /pulse-sw.js so its
 * default scope is "/" (root), but we restrict it to "/pulse" via the
 * `scope: "/pulse"` registration option. Combined with the manifest's
 * `scope: "/pulse"`, this guarantees no interference with marketing-site
 * navigation. The browser will reject scope expansion above the SW's URL
 * path (so a `/pulse-sw.js` at root can't claim "/pulse" without the
 * Service-Worker-Allowed header, BUT registering with a narrower scope
 * is always allowed — that's the path we take).
 *
 * Mounted from app/pulse/layout.tsx so every /pulse/* route benefits.
 */
export default function PWARegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Register on next tick to avoid contending with first paint.
    const t = window.setTimeout(() => {
      navigator.serviceWorker
        .register("/pulse-sw.js", { scope: "/pulse" })
        .catch((err) => {
          // Soft-fail — registration is best-effort. The page still works,
          // just without PWA install eligibility. Common causes: dev-mode
          // HMR, no-https in non-localhost contexts, content-blocker.
          console.warn("[PWARegister] /pulse-sw.js registration failed", err);
        });
    }, 0);

    return () => window.clearTimeout(t);
  }, []);

  return null;
}
