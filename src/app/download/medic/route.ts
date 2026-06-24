import { NextResponse } from "next/server";

export const runtime = "nodejs";
// The APK rarely changes and the redirect target is derived from a public env
// var, so let the route be cached/static-friendly.
export const dynamic = "force-static";

// Sanocare Medic Android app — public download.
//
// 302-redirects to the APK hosted in the PUBLIC `medic-app` Supabase Storage
// bucket at a STABLE path. We overwrite that one object each release, so this
// route (and the footer link pointing at it) never change — only the bucket
// object is bumped. See the PR / README for the per-release update step.
//
// Public is acceptable by founder decision (2026-06-23): app sign-in is OTP-gated
// to phones in the medics table, so a non-medic can install but can never log in.
// We deliberately do NOT link to the GitHub release (it's a private repo).

const OBJECT_PATH =
  "storage/v1/object/public/medic-app/sanocare-medic-latest.apk";

export function GET() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) {
    return NextResponse.json(
      { error: "storage_unconfigured" },
      { status: 500 },
    );
  }
  const url = `${base.replace(/\/+$/, "")}/${OBJECT_PATH}`;
  return NextResponse.redirect(url, 302);
}
