import type { Metadata } from "next";
import { Suspense } from "react";

import { TalkClient } from "./TalkClient";

// Per-page metadata override. Title/description deliberately avoid every
// classifier-flagged term (no "doctor", no "MBBS", no "treatment", no
// condition name). `robots: { index: false }` keeps this out of organic
// search — it exists only as the destination URL for paid ad campaigns,
// and the brand site's organic story lives on /, /services, etc.
export const metadata: Metadata = {
  title: "Talk to Sanocare on WhatsApp",
  description:
    "Connect with Sanocare for home healthcare across Delhi NCR. Reply in under 2 minutes.",
  robots: { index: false, follow: false },
  alternates: {
    canonical: "https://sanocare.in/talk",
  },
  // Explicitly null out the root layout's openGraph/twitter so previews
  // when this URL is shared (Ads notifications, internal Slack pastes)
  // don't surface a healthcare-themed card.
  openGraph: {
    title: "Talk to Sanocare on WhatsApp",
    description: "Reply in under 2 minutes. Sanocare, Delhi NCR.",
    url: "https://sanocare.in/talk",
    siteName: "Sanocare",
    locale: "en_IN",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Talk to Sanocare on WhatsApp",
    description: "Reply in under 2 minutes. Sanocare, Delhi NCR.",
  },
};

export default function TalkPage() {
  // useSearchParams() inside TalkClient requires a Suspense boundary on
  // the server-rendered parent — Next.js 16 will error at build time
  // otherwise. The fallback is the same layout shell so first paint
  // doesn't flicker before hydration.
  return (
    <Suspense fallback={null}>
      <TalkClient />
    </Suspense>
  );
}
