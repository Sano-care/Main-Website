"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { PulseCustomer } from "./getCurrentCustomer";

// Client-side handle on the signed-in Pulse customer.
//
// PulseShell (a server component) resolves the customer once on the server
// and seeds this provider so client components — the vitals/medication
// surfaces, the account chip in the header — can read identity without a
// round-trip. The value is the trusted, server-resolved customer; client
// code never re-derives identity from cookies.
//
// T64 will extend this with the managed-member array + an active-member
// switcher; `useCurrentCustomer()` stays the "primary / active customer"
// accessor.

const PulseCustomerContext = createContext<PulseCustomer | null>(null);

export function PulseCustomerProvider({
  customer,
  children,
}: {
  customer: PulseCustomer;
  children: ReactNode;
}) {
  return (
    <PulseCustomerContext.Provider value={customer}>
      {children}
    </PulseCustomerContext.Provider>
  );
}

/**
 * The signed-in customer. Throws if called outside a PulseShell — that
 * always indicates a component rendered outside the authenticated tree,
 * which is a bug worth surfacing loudly rather than a null to thread.
 */
export function useCurrentCustomer(): PulseCustomer {
  const customer = useContext(PulseCustomerContext);
  if (!customer) {
    throw new Error(
      "useCurrentCustomer() must be used within a <PulseShell> (PulseCustomerProvider).",
    );
  }
  return customer;
}
