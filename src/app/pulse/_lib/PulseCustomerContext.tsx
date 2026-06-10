"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { PulseCustomer } from "./getCurrentCustomer";

// Client-side handle on the signed-in Pulse customer.
//
// The (authed) route-group layout (src/app/pulse/(authed)/layout.tsx)
// resolves the customer once on the server and seeds this provider so
// client components — the vitals/medication surfaces, PulseAppBar, etc.
// — can read identity without a round-trip. The value is the trusted,
// server-resolved customer; client code never re-derives identity from
// cookies.
//
// T90 Step 06 introduced the parallel MemberViewingContext for the
// active-viewing-member state (members array + viewing target +
// localStorage persistence). useCurrentCustomer() stays the "account
// holder" accessor — distinct from useViewingMember() which tracks
// which person the user is currently looking at.

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
 * The signed-in customer. Throws if called outside the (authed) layout —
 * that always indicates a component rendered outside the authenticated
 * tree, which is a bug worth surfacing loudly rather than a null to
 * thread.
 */
export function useCurrentCustomer(): PulseCustomer {
  const customer = useContext(PulseCustomerContext);
  if (!customer) {
    throw new Error(
      "useCurrentCustomer() must be used within the (authed) layout's <PulseCustomerProvider>.",
    );
  }
  return customer;
}
