"use client";

// T85 PR3 — homepage sticky-bar wrapper.
//
// Pre-PR3: mounted T61's `MobileStickyBar` (3 CTAs: Book / Call /
// WhatsApp) with a useBookingFlow-wired onBook handler.
//
// Post-PR3: mounts the new `ServiceStickyBar` (4-service wayfinding
// nav). ServiceStickyBar is self-contained (reads the SERVICES catalog
// directly, owns its own scroll behaviour), so no handlers need
// threading. Keeping the HomeStickyBar wrapper alive — even as a thin
// passthrough — preserves the homepage's existing import surface
// (`@/components/marketing/HomeStickyBar`) and gives PR4/PR5 a stable
// hook if we ever need to wire booking state into the bar again.
//
// MobileStickyBar (the T61 component) is now orphaned on the homepage
// but still exported from the components barrel. PR5 audits whether
// any other surface references it and either retires the file or
// keeps it for a non-homepage use case.

import { ServiceStickyBar } from "@/components/marketing/ServiceStickyBar";

export function HomeStickyBar() {
  return <ServiceStickyBar />;
}
