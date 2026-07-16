import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-static";

// Sanocare Pulse (patient) Android app — UAT distribution.
// 302 → stable object in the PUBLIC `pulse-app` bucket, overwritten each release.
// NOTE: unlike /download/medic, this is NOT linked from the footer/nav yet — the
// patient app is OTP-open to any phone, so we keep it unlisted until public launch.
const OBJECT_PATH = "storage/v1/object/public/pulse-app/sanocare-pulse-latest.apk";

export function GET() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return NextResponse.json({ error: "storage_unconfigured" }, { status: 500 });
  const url = `${base.replace(/\/+$/, "")}/${OBJECT_PATH}`;
  return NextResponse.redirect(url, 302);
}
