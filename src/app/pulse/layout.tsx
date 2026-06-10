import type { Metadata, Viewport } from "next";

import PWARegister from "./_components/PWARegister";
import PulseChrome from "./_components/PulseChrome";
import { PulseCustomerProvider } from "./_lib/PulseCustomerContext";
import { getCurrentCustomer } from "./_lib/getCurrentCustomer";

/**
 * T90 Pulse v1 Phase 1 — nested layout for the /pulse scope.
 *
 * Phase 1 scope of THIS layout (after Step 05):
 *   1. Override the root manifest with the Pulse-scoped one
 *      (`/pulse-manifest.json` — start_url + scope both "/pulse").
 *   2. Set the install-time theme color to Sanocare primary blue.
 *   3. Mount the service-worker registrar (`<PWARegister />`).
 *   4. When a customer is signed in, wrap children with
 *      <PulseCustomerProvider /> and the <PulseChrome /> shell
 *      (top app bar + drawer). When no customer (e.g., /pulse/login),
 *      render children bare — no chrome, no provider.
 *
 * Out of scope for Phase 1 / this commit:
 *   - Auth gate. The layout does NOT redirect on null customer — it just
 *     skips the chrome. /pulse/login + (future) /pulse/welcome render
 *     without chrome. Authenticated pages keep their existing
 *     `<PulseShell>` wrappers which redirect on null. Step 08 migrates
 *     pages off PulseShell and absorbs `redirect('/pulse/login')` here.
 *   - Onboarding chrome suppression. When /pulse/welcome lands in Step 09
 *     it will render WITHOUT chrome — handled either via a route group
 *     (`(onboarding)`) or by PulseChrome reading `usePathname()`. Step 05
 *     ships the chrome unconditionally for authenticated routes; the
 *     suppression hook lands with Step 09.
 *
 * Visual transient through Steps 05-07: existing pages keep <PulseShell>
 * and render their own PulsePageHeader, so each route shows TWO stacked
 * headers (the new sticky PulseAppBar + the in-page legacy header). This
 * is expected on-branch; prod stays on v0.1 until merge. Step 08 drops
 * <PulseShell> + PulsePageHeader from each page.
 *
 * Deliberate non-decision: no `<html>` / `<body>` here — those belong to
 * the root layout at `src/app/layout.tsx`. Nested layouts under App Router
 * only render their own subtree.
 *
 * Manifest-path deviation note: brief specifies `public/manifest.json`,
 * but the marketing root layout already binds `/manifest.json` to a
 * site-wide PWA (start_url "/"). We ship the Pulse manifest at
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

export default async function PulseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const customer = await getCurrentCustomer();

  // Unauthenticated path: /pulse/login renders bare. The login page's own
  // server-side getCurrentCustomer() check handles "already signed in →
  // bounce to ?next=". Welcome (Step 09) will live under this branch too.
  if (!customer) {
    return (
      <>
        {children}
        <PWARegister />
      </>
    );
  }

  // Authenticated path: seed PulseCustomerProvider so PulseAppBar +
  // PulseDrawer can read identity via useCurrentCustomer(). PulseShell
  // wrappers on individual pages also seed this provider (Step 08 will
  // remove them) — nested providers are harmless; inner just wins with
  // the same value because both calls resolve from the same cookie.
  return (
    <>
      <PulseCustomerProvider customer={customer}>
        <PulseChrome>{children}</PulseChrome>
      </PulseCustomerProvider>
      <PWARegister />
    </>
  );
}
