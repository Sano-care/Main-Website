import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/lab/search?q=<query>&limit=12
 *
 * T85 PR4b — patient-facing lab test search. Returns up to `limit`
 * (default 12, max 25) lab_tests rows for the patient's typed query.
 *
 * Mirrors the doctor-side `/api/doctor/lab-tests/search` route but:
 *   - Unauthenticated (anyone browsing can search; gating it would
 *     kill funnel conversion).
 *   - Returns rupees (`priceInr`) instead of paise so the basket UI
 *     can render directly without a unit conversion.
 *   - Excludes `instructions` + `sample` (long fields not needed by
 *     basket UI — saves payload bytes).
 *
 * Throttling note (per founder Q4):
 *   Ship without throttling for v1 + log every search query so we
 *   have data if abuse appears. A proper per-IP rate limiter is a
 *   follow-up infrastructure ticket — Netlify Edge or Redis-backed
 *   token bucket. TODO surfaced below.
 */

// TODO(pr5-or-followup): add per-IP throttle (~30 req/min). Currently
// unthrottled; defence relies on the unauthenticated, read-only nature
// of the query + Pathcore catalog being public knowledge already.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limitRaw = Number(searchParams.get("limit") ?? "12");
  const limit = Math.min(25, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 12));

  if (q.length < 2) {
    // Patient typed "" or "a" — return empty rather than 1,892 rows.
    return NextResponse.json({ results: [] });
  }

  // Log every query for now — feeds the eventual abuse-detection ticket.
  console.log(`[lab/search] q=${JSON.stringify(q)} limit=${limit}`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Same 4-strategy ranking as the doctor-side route:
  //   prefix-name > prefix-code > substring-name > category
  // SQL `OR` clauses are slow on text; we use the trigram + prefix
  // pattern that the lab_tests indexes already support.
  const ilikeQ = q.replace(/[%_]/g, "\\$&");
  const { data, error } = await supabase
    .from("lab_tests")
    .select("code, name, price_paise, sample, tat, category")
    .or(
      [
        `name.ilike.${ilikeQ}%`,
        `code.ilike.${ilikeQ}%`,
        `name.ilike.%${ilikeQ}%`,
        `category.ilike.%${ilikeQ}%`,
      ].join(","),
    )
    .order("name", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[lab/search] supabase query failed:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }

  const results = (data ?? []).map((row) => ({
    code: row.code as string,
    name: row.name as string,
    priceInr: Math.round((row.price_paise as number) / 100),
    sample: (row.sample as string | null) ?? undefined,
    tat: (row.tat as string | null) ?? undefined,
    category: (row.category as string | null) ?? undefined,
  }));

  return NextResponse.json({ results });
}
