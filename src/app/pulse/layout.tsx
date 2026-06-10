import type { Metadata, Viewport } from "next";

import PWARegister from "./_components/PWARegister";

/**
 * T90 Pulse v1 Phase 1 — nested layout for the /pulse scope.
 *
 * Phase 1 scope of THIS layout:
 *   1. Override the root manifest with the Pulse-scoped one
 *      (`/pulse-manifest.json` — start_url + scope both "/pulse").
 *   2. Set the install-time theme color to Sanocare primary blue.
 *   3. Mount the service-worker registrar (`<PWARegister />`).
 *
 * Out of scope for Phase 1 / this commit:
 *   - App bar + drawer (Step 05 wires `<PulseAppBar>` + `<PulseDrawer>` here).
 *   - Auth gate (Step 08 migrates pages off `<PulseShell>` and absorbs the
 *     `requireAuth → redirect /pulse/login` flow into this layout). For now,
 *     pages keep their existing `<PulseShell>` wrappers so auth still works.
 *   - Suspense boundary (added with the app-bar tree).
 *
 * Deliberate non-decision: no `<html>` / `<body>` here — those belong to the
 * root layout at `src/app/layout.tsx`. Nested layouts under App Router only
 * render their own subtree.
 *
 * Note on the manifest path: the brief specifies `public/manifest.json`, but
 * the marketing root layout already binds `/manifest.json` to a site-wide
 * PWA install (start_url "/"). Overwriting that would (a) break marketing
 * installability and (b) redirect any existing marketing-installed PWAs to
 * /pulse on next launch. We instead ship the Pulse manifest at
 * `/pulse-manifest.json` and let Next.js metadata cascade override the
 * inherited `/manifest.json` for everything under /pulse.
 */

export const metadata: Metadata = {
  manifest: "/pulse-manifest.json",
};

// In Next 14+ `themeColor` lives on `viewport`, not `metadata` (placing it
// on metadata emits a deprecation warning at build time). Sanocare primary
// blue — matches the manifest's `theme_color` so the install splash and
// the in-app theme stay aligned.
export const viewport: Viewport = {
  themeColor: "#2B81FF",
};

export default function PulseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <PWARegister />
    </>
  );
}
