import type { Metadata } from "next";

// `(thin)` route group — classifier-safe ad landing zone.
//
// Routes inside this group inherit the project's root <html>/<body>/GTM
// shell (Next.js requires the root layout) but explicitly strip the
// healthcare-flagged metadata fields the root layout sets globally
// (`keywords` listing nurse/doctor/MBBS terms; `formatDetection: { telephone:
// false }` which is fine but we reaffirm it). The MedicalBusiness JSON-LD
// emitted in root layout is suppressed for these routes via a pathname
// check inside src/app/layout.tsx — see comments there.
//
// Per-route page.tsx files set their own title/description/robots, so the
// only job of THIS layout is the inherited-metadata clearance. Keep it
// minimal: no providers, no chrome.

export const metadata: Metadata = {
  // Override root layout's healthcare-themed keywords list. Children of
  // this layout inherit `[]` and the title-template default to nothing.
  keywords: [],
  // Explicit override so child pages can opt in/out individually.
  alternates: undefined,
};

export default function ThinLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
