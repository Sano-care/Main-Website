// T65 Phase 1 — current medic profile (for app cold-start re-hydration).
//
// GET /api/medic-app/me → returns the medic row for the cookied medic_id.
// Used by the Android app's AuthGate to re-hydrate full_name + qualification
// when DataStore only carries the session cookie (the cookie is the auth
// boundary; the medic profile is convenience data).
//
// 401 if no medic cookie; 404 if the cookie's medic_id is no longer
// present in the medics table (medic was soft-deleted while the cookie
// was still valid — client should sign out).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireMedic } from "@/lib/auth/requireMedic";

export const runtime = "nodejs";

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: NextRequest) {
  const auth = await requireMedic(request);
  if (auth instanceof NextResponse) return auth;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const { data: medic, error } = await supabase
    .from("medics")
    .select("id, full_name, phone, qualification, active")
    .eq("id", auth.medic_id)
    .maybeSingle();

  if (error) {
    console.error("[medic-app/me] lookup failed", error);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!medic || !medic.active) {
    return NextResponse.json({ error: "medic_not_found" }, { status: 404 });
  }

  return NextResponse.json({
    medic: {
      id: medic.id,
      full_name: medic.full_name,
      phone: medic.phone,
      qualification: medic.qualification,
    },
  });
}
