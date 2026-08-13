import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { loadAndQuoteCart, normalizeCartItems } from "@/lib/medic/serverCart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/pulse/medic/quote
 *
 * Read-only. Runs the server-authoritative pricing engine over a cart of
 * {code, qty} (+ optional units/hours) and returns the breakdown for the
 * sticky total + at-visit line. Writes nothing. Bearer-authed so only the
 * signed-in patient can price — the money is computed here, never on the
 * client.
 *
 * Body: { items: [{ code, qty, units?, hours? }] }
 * 200 { quote, rx: { required: string[], caseByCase: string[] } }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePulseCustomer(req);
    if ("response" in auth) return auth.response;

    const body = await req.json().catch(() => null);
    const items = normalizeCartItems(body?.items);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: "Server credentials missing" }, { status: 500 });
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { quote, rxYes, rxCaseByCase } = await loadAndQuoteCart(supabase, items);
    return NextResponse.json({
      quote,
      rx: { required: rxYes, caseByCase: rxCaseByCase },
    });
  } catch (err) {
    console.error("[pulse/medic/quote] error:", err);
    const message = err instanceof Error ? err.message : "Failed to quote cart";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
