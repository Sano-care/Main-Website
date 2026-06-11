import { redirect } from "next/navigation";

import { getCurrentCustomer } from "../_lib/getCurrentCustomer";

/**
 * T90 Pulse v1 Phase 1 — (onboarding) route group layout.
 *
 * Auth-gated but chrome-less surface for the welcome flow. The welcome
 * pages are full-screen onboarding (Surface 1 of the brief): brand
 * lockup at top, large headline, no app bar / no drawer / no avatar
 * menu — the user is mid-flow and the chrome would compete with the
 * single-focus card.
 *
 * Responsibilities:
 *   1. Resolve the signed-in customer server-side (a Pulse-only user
 *      who hits /pulse/welcome without an OTP-verify cookie should be
 *      bounced to /pulse/login).
 *   2. Redirect-to-login on null customer.
 *   3. Pass children through bare — NO <PulseChrome />, NO
 *      <PulseCustomerProvider />. Onboarding pages don't read identity
 *      via React context; they read it via the cookie + the API routes
 *      they call (e.g., AddMemberForm posting to /api/pulse/family-members).
 *
 * Why an auth gate at all if no provider: a user direct-navigating to
 * /pulse/welcome from a bookmark or share link with no cookie should
 * land on /pulse/login, not see an empty welcome page that errors when
 * they tap the family-add CTA.
 *
 * Sequence the user moves through:
 *   /pulse/login          ← (auth) group, no auth gate
 *   /pulse/welcome        ← (onboarding) group, this layout — Step 1
 *   /pulse/welcome/family ← (onboarding) group, this layout — Step 2
 *   /pulse                ← (authed) group, full chrome
 */

export default async function PulseOnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const customer = await getCurrentCustomer();
  if (!customer) {
    redirect(`/pulse/login?next=${encodeURIComponent("/pulse/welcome")}`);
  }
  return <>{children}</>;
}
