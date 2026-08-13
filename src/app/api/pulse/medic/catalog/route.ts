import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/pulse/medic/catalog
 *
 * The active Medic-at-Home procedure catalog for the Phase B cart UI (tier
 * sections + search). Bearer-authed like the rest of /api/pulse/*; read-only.
 * Prices are frozen and come straight from home_care_procedures — the client
 * displays them but never uses them to compute a payable total (that's
 * /quote + /create-order, server-side).
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePulseCustomer(req);
    if ("response" in auth) return auth.response;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: "Server credentials missing" }, { status: 500 });
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data, error } = await supabase
      .from("home_care_procedures")
      .select(
        "code, name, category, tier, rx_required, is_base_included, absolute_price_paise, delta_paise, price_type, per_unit_addon_paise, hourly_addon_paise, consumables_borne_by, consumables_note, duration_min, description, display_order",
      )
      .eq("is_active", true)
      .order("display_order", { ascending: true });

    if (error) {
      console.error("[pulse/medic/catalog] load failed:", error);
      return NextResponse.json({ error: "Could not load the catalog." }, { status: 500 });
    }

    return NextResponse.json({
      base_visit_paise: 19_900,
      base_extra_unit_paise: 10_000,
      procedures: data ?? [],
    });
  } catch (err) {
    console.error("[pulse/medic/catalog] error:", err);
    const message = err instanceof Error ? err.message : "Failed to load catalog";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
