import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Server-component Supabase client. Reads the session from cookies set by
 * the browser client + middleware. RLS applies (anon/authenticated role),
 * so this NEVER exposes service-role privileges.
 *
 * Server components can only read cookies, not write them — write attempts
 * are swallowed here; cookie refresh is handled by middleware.
 */
export async function createOpsRSCClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // No-op in server components — middleware refreshes the session.
        },
      },
    },
  );
}
