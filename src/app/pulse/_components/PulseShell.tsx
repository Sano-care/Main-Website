import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getCurrentCustomer } from "../_lib/getCurrentCustomer";
import { PulseCustomerProvider } from "../_lib/PulseCustomerContext";

// Server wrapper for every authenticated Pulse page.
//
// Responsibilities:
//   1. Resolve the signed-in customer server-side (getCurrentCustomer).
//   2. Redirect unauthenticated visitors to /pulse/login, preserving where
//      they were headed via ?next= so login can bounce them straight back.
//   3. Seed the client PulseCustomerProvider so descendant client components
//      can read identity without a fetch.
//
// Usage (in e.g. src/app/pulse/vitals/page.tsx):
//   export default function VitalsPage() {
//     return (
//       <PulseShell next="/pulse/vitals">
//         <VitalsSurface />
//       </PulseShell>
//     );
//   }
//
// `next` defaults to "/pulse". Pass the page's own path so a bounced login
// returns the patient to the exact surface they asked for.

export async function PulseShell({
  children,
  next = "/pulse",
}: {
  children: ReactNode;
  /** Path to return to after login. Defaults to the Pulse home. */
  next?: string;
}) {
  const customer = await getCurrentCustomer();

  if (!customer) {
    redirect(`/pulse/login?next=${encodeURIComponent(next)}`);
  }

  return (
    <PulseCustomerProvider customer={customer}>
      {children}
    </PulseCustomerProvider>
  );
}
