import type { Metadata } from "next";

import RecordsSurface from "./RecordsSurface";

// Pulse "Your records" (Slice B). The (authed) route-group layout is the auth
// gate + chrome + provider mount, so this page is a thin shell: all data loads
// client-side via /api/pulse/records, keyed off the active viewing member.
export const metadata: Metadata = {
  title: "Your records · Sanocare Pulse",
};

export default function RecordsPage() {
  return <RecordsSurface />;
}
