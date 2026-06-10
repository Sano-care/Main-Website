import type { Metadata, Viewport } from "next";

import PWARegister from "./_components/PWARegister";

/**
 * T90 Pulse v1 Phase 1 — root /pulse layout.
 *
 * This is the OUTER layout for everything under /pulse/*. After Step 08
 * it's deliberately minimal — three responsibilities only:
 *   1. Override the root manifest with the Pulse-scoped one
 *      (`/pulse-manifest.json` — start_url + scope both "/pulse").
 *   2. Set the install-time theme color to Sanocare primary blue.
 *   3. Mount the service-worker registrar (`<PWARegister />`).
 *
 * Auth + chrome live in `(authed)/layout.tsx`. Login + (future) welcome
 * live in their own route groups outside `(authed)` and inherit only
 * this minimal shell — no auth gate, no chrome.
 *
 * Route-group map:
 *   src/app/pulse/
 *     layout.tsx          ← THIS file (minimal root shell)
 *     (auth)/
 *       login/...         ← bare surface, no auth, no chrome
 *     (authed)/
 *       layout.tsx        ← auth gate + <PulseChrome /> wrap
 *       page.tsx          ← home
 *       vitals/
 *       medications/
 *       family-members/
 *   (Step 09 adds an (onboarding) group for /pulse/welcome — bare
 *    surface like login but with an auth gate.)
 *
 * Deliberate non-decision: no `<html>` / `<body>` here — those belong
 * to the root layout at `src/app/layout.tsx`. Nested layouts under App
 * Router only render their own subtree.
 *
 * Manifest-path deviation note (carried from Step 04): brief specifies
 * `public/manifest.json`, but the marketing root layout already binds
 * `/manifest.json` to a site-wide PWA (start_url "/"). We ship the
 * Pulse manifest at `/pulse-manifest.json` and let Next.js metadata
 * cascade override the inherited `/manifest.json` for everything under
 * /pulse.
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
