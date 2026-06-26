import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runLabTestSearch } from "@/lib/lab/search";

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

  // Single shared query (src/lib/lab/search.ts) — same ranking the Aarogya
  // search_lab_tests tool uses, so chat results match the website. No parallel
  // search implementation.
  const data = await runLabTestSearch(q, { limit, supabase });

  const results = data.map((row) => ({
    code: row.code,
    name: row.name,
    priceInr: Math.round((row.price_paise as number) / 100),
    sample: row.sample ?? undefined,
    tat: row.tat ?? undefined,
    category: row.category ?? undefined,
  }));

  return NextResponse.json({ results });
}
