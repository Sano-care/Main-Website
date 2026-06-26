import type { Metadata } from "next";

import RecordsLanding from "./RecordsLanding";

// Pulse "Your records" (R1 redesign). The (authed) route-group layout is the
// auth gate + chrome + provider mount, so this page is a thin shell: the tiered
// tile grid loads client-side via /api/pulse/records, keyed off the active
// viewing member. Per-category detail screens live at /pulse/records/[category].
export const metadata: Metadata = {
  title: "Your records · Sanocare Pulse",
};

export default function RecordsPage() {
  return <RecordsLanding />;
}
