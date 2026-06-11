import { redirect } from "next/navigation";

import PulseChrome from "../_components/PulseChrome";
import { PulseCustomerProvider } from "../_lib/PulseCustomerContext";
import { getCurrentCustomer } from "../_lib/getCurrentCustomer";

/**
 * T90 Pulse v1 Phase 1 — (authed) route group layout.
 *
 * This layout is the single auth gate for every authenticated Pulse page.
 * It absorbs what <PulseShell> used to do per-page:
 *   1. Resolve the signed-in customer server-side (getCurrentCustomer)
 *   2. Redirect unauthenticated visitors to /pulse/login, preserving the
 *      target via ?next= so login can bounce them straight back
 *   3. Seed the <PulseCustomerProvider> so descendant client components
 *      read identity without an additional fetch
 *   4. Wrap children in <PulseChrome /> — the v1 top bar + drawer +
 *      overlays (member-switcher sheet, avatar menu) + viewing-state
 *      provider (members fetch + active-member state)
 *
 * URL preservation: Next.js layouts don't receive the request path
 * directly. The /pulse/login destination's ?next= param therefore lands
 * the user back at /pulse (root home) rather than the exact path they
 * tried. That matches the pre-Step-08 behaviour for the home page (next
 * defaulted to /pulse) and is acceptable for v1. A follow-up could
 * thread the path via middleware or a server action; deferred.
 *
 * Route-group structure:
 *   src/app/pulse/
 *     layout.tsx          ← root: metadata + PWA register + passthrough
 *     (auth)/login/...    ← bare surface, no auth, no chrome
 *     (authed)/...        ← THIS layout — auth gate + chrome
 *
 * The (auth) group has no layout.tsx of its own; login inherits the
 * minimal root layout (no chrome, no auth — the login surface itself).
 */

export default async function PulseAuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const customer = await getCurrentCustomer();
  if (!customer) {
    // Preserve any deep target via ?next=. Without the request path
    // here, we default to /pulse — the login bounce will land the
    // user at the home zone on success.
    redirect(`/pulse/login?next=${encodeURIComponent("/pulse")}`);
  }

  return (
    <PulseCustomerProvider customer={customer}>
      <PulseChrome>{children}</PulseChrome>
    </PulseCustomerProvider>
  );
}
