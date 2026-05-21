import { permanentRedirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ops · Dashboard",
  robots: { index: false, follow: false },
};

/**
 * Legacy /ops/dashboard — superseded by /ops/bookings in Milestone 2.
 *
 * The previous client-side dashboard used the localStorage-based
 * @supabase/supabase-js client from src/lib/supabase.ts. After M0 moved
 * the ops session into cookies (via @supabase/ssr) and M2 enabled RLS on
 * bookings, that localStorage client could no longer send a valid JWT,
 * so its bookings queries returned nothing and the page crashed.
 *
 * Rather than retrofit the legacy client to read cookies, we retire the
 * route: it now redirects to /ops/bookings, which does all data access
 * server-side with the cookie-authed client and passes RLS cleanly.
 *
 * The old components subtree (dashboard/components/*) is left in place
 * for now in case anything from the paramedic-dispatch / field-force /
 * realtime-pulse flows needs to be revived in a future milestone — none
 * of it is imported anywhere after this redirect.
 */
export default function LegacyDashboardRedirect() {
  // 308 — semantics match: "this URL is permanently superseded by the new one".
  // Browsers + crawlers cache it; ops bookmarks update on next click.
  permanentRedirect("/ops/bookings");
}
