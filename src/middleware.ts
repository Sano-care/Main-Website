import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Middleware guard for /ops/*.
 *
 *   - Unauthenticated visitor       → /ops/login?next=<original-path>
 *   - Authenticated, not in ops_users → /ops/no-access
 *   - Authenticated and in ops_users → through
 *
 * Skips:
 *   - /ops/login        (the sign-in page itself)
 *   - /ops/no-access    (shown to signed-in users without ops membership)
 *
 * The membership check uses a Supabase select against `ops_users` with RLS
 * enabled — the request runs as the authenticated user, so they can only
 * see their own row if the policy `ops_users readable by ops` allows it.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // /talk (and any future classifier-safe ad landing pages) need the
  // pathname surfaced to the root server layout so it can opt OUT of the
  // MedicalBusiness JSON-LD on these routes. The matcher below includes
  // /talk just for this header pass-through — no auth gating needed.
  // See src/app/layout.tsx for the consumer of x-pathname.
  if (pathname.startsWith("/talk")) {
    const res = NextResponse.next({ request: req });
    res.headers.set("x-pathname", pathname);
    return res;
  }

  // Don't gate the login or no-access screens.
  if (pathname === "/ops/login" || pathname === "/ops/no-access") {
    return NextResponse.next();
  }

  const res = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set({ name, value, ...options });
          });
        },
      },
    },
  );

  // IMPORTANT: getUser() validates the JWT against Supabase. Do not trust
  // getSession() alone in middleware — its return value is unverified.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/ops/login";
    loginUrl.searchParams.set("next", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  const { data: opsUser } = await supabase
    .from("ops_users")
    .select("id")
    .eq("id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!opsUser) {
    const noAccessUrl = req.nextUrl.clone();
    noAccessUrl.pathname = "/ops/no-access";
    noAccessUrl.search = "";
    return NextResponse.redirect(noAccessUrl);
  }

  return res;
}

export const config = {
  matcher: ["/ops/:path*", "/talk/:path*", "/talk"],
};
