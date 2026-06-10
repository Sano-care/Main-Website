import { redirect } from "next/navigation";

import { getCurrentCustomer } from "../../_lib/getCurrentCustomer";
import { sanitizeNext } from "../../_lib/safeNext";
import { PulseLoginForm } from "./PulseLoginForm";

// Sanocare Pulse sign-in.
//
// One flow, no separate sign-up: phone → OTP → (if the verified number has
// no customer row yet) name capture → into Pulse. Reuses the shared
// /api/auth/send-otp + /api/auth/verify-otp routes (Rampwin WhatsApp OTP
// template) and the /api/pulse/account bridge.
//
// If the visitor is already signed in (valid cookie + existing customer) we
// skip the form entirely and bounce to ?next=.

export const dynamic = "force-dynamic";

export default async function PulseLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = sanitizeNext(next);

  const customer = await getCurrentCustomer();
  if (customer) {
    redirect(safeNext);
  }

  return <PulseLoginForm next={safeNext} />;
}
