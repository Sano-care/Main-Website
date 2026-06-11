import { getCurrentCustomer } from "../../_lib/getCurrentCustomer";
import WelcomeStep1Client from "./WelcomeStep1Client";

/**
 * T90 Pulse v1 Phase 1 — Welcome Step 1 page (Surface 1 of brief).
 *
 * Server component: resolves the existing customers.full_name so the
 * client can pre-fill the name input. For brand-new Pulse users
 * (auto-upserted by /api/auth/verify-otp with phone only), full_name
 * is null → input starts empty + autofocuses. For booking-only
 * customers Pulse-signing for the first time, full_name may already
 * be populated → input pre-filled, no-op path on Continue.
 *
 * The (onboarding) layout already redirected to /pulse/login if the
 * customer was null — this page's `customer` is guaranteed non-null.
 *
 * Force-dynamic so the pre-fill always reflects the latest
 * full_name (in case the user edited it elsewhere between sessions).
 */

export const dynamic = "force-dynamic";

export default async function PulseWelcomeStep1Page() {
  const customer = await getCurrentCustomer();
  const initialName = customer?.full_name?.trim() ?? "";
  return <WelcomeStep1Client initialName={initialName} />;
}
