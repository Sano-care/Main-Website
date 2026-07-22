import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/pulse/profile
 *
 * v2.1 (Pulse app) — read-back for the Profile tab. The email / health-notes
 * editors were write-only (POST /profile/email + POST /profile/health-notes),
 * so after saving, the app had nothing to DISPLAY and kept showing "Add email".
 * This returns the signed-in customer's own current values so the app can show
 * them and pre-fill the editors.
 *
 * Additive, customer-scoped (own `customers` row only — server reads identity
 * from the bearer token / verify cookie via `requirePulseCustomer`; no target
 * param). No new table or column, no migration. Mirrors the auth + shape of the
 * sibling POST /api/pulse/profile/email route.
 *
 *   200 { email: string | null, health_notes: string | null }
 *   401 { error }  — no valid bearer / verify cookie
 *   500 { error }  — DB error
 */
export async function GET(req: NextRequest) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const { data, error } = await supabaseAdmin
    .from("customers")
    .select("email, health_notes")
    .eq("id", customer.id)
    .maybeSingle();

  if (error) {
    console.error("[pulse/profile] GET failed:", error);
    return NextResponse.json(
      { error: "Could not load your profile. Try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    email: (data?.email as string | null) ?? null,
    health_notes: (data?.health_notes as string | null) ?? null,
  });
}
