import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client that persists the session in cookies
 * (instead of localStorage). Used by /ops/* pages so the same session
 * is visible to server middleware + RSC server components.
 *
 * Keep `src/lib/supabase.ts` for the rest of the app — that one still
 * uses localStorage and is fine for purely client-side reads of public
 * tables (CMS, lab-tests JSON, etc.).
 */
export function createOpsBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_ANON_KEY!,
  );
}
