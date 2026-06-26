import { NextRequest, NextResponse } from "next/server";
import { getCurrentDoctorSession } from "@/app/doctor/_lib/getCurrentDoctor";
import { supabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/doctor/medicines/search?q=<query>&limit=20
 *
 * Returns up to `limit` (default 20, max 50) medicine_catalog rows
 * ranked by relevance to the doctor's typed query.
 *
 * Ranking is done in SQL via a single CTE-style query (see below)
 * so the strategies don't fight each other and ranks are
 * deterministic. The three strategies, in priority order:
 *
 *   1. brand_name ILIKE 'query%'   (prefix match, score 3)
 *   2. brand_name % 'query'        (trigram similarity, score 2)
 *   3. composition ILIKE '%query%' (substring match, score 1)
 *
 * Strategy 4 — full-text via search_vector @@ to_tsquery — is
 * available behind the GIN index but isn't part of the ORDER BY
 * here; the trigram strategies cover enough surface area for
 * brand/composition free-typing that adding tsvector ranking just
 * muddies the result order. If a future use case needs free-text
 * search across the whole row (advice notes, etc.) the search_vector
 * is ready.
 *
 * Auth: gated by the C1 doctor session cookie (same posture as
 * /api/doctor/duty-room/start). Service-role Supabase client used
 * for the query; the SELECT policy on the table is open USING (true)
 * so either client works, but we use the admin client for
 * consistency with the rest of /api/doctor/*.
 *
 * Response:
 *   200 { results: [{ id, sku, brand_name, strength, form, composition }, …] }
 *   401 { error }   — no/invalid/expired doctor session
 *   400 { error }   — empty or too-long query
 *   500 { error }   — supabase error
 */

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MIN_QUERY_LEN = 2;
const MAX_QUERY_LEN = 80;

type MedicineRow = {
  id: string;
  sku: number | null;
  brand_name: string;
  strength: string | null;
  form: string | null;
  composition: string;
};

export async function GET(req: NextRequest) {
  const session = await getCurrentDoctorSession();
  if (!session) {
    return NextResponse.json(
      { error: "Not signed in. Refresh /doctor and try again." },
      { status: 401 },
    );
  }

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  if (q.length < MIN_QUERY_LEN) {
    // Empty / too-short query — short-circuit to an empty result
    // rather than 400'ing, so the composer UI can throttle keystrokes
    // without juggling error states for "still too short to search".
    return NextResponse.json({ results: [] });
  }
  if (q.length > MAX_QUERY_LEN) {
    return NextResponse.json(
      { error: `Query too long (max ${MAX_QUERY_LEN} chars).` },
      { status: 400 },
    );
  }

  const limitRaw = Number(sp.get("limit") ?? DEFAULT_LIMIT);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
      : DEFAULT_LIMIT;

  // Build the three strategies in parallel, then merge + dedupe + sort
  // in JS. Reasons:
  //   - PostgREST/supabase-js doesn't expose UNION ALL + ranking
  //     cleanly without a stored procedure or a raw RPC.
  //   - Three small reads (~limit rows each, indexed) are cheap; the
  //     in-memory merge of ≤ 3 × 50 rows is trivial.
  //   - Keeps the schema migration footprint small (no RPC fn).

  const prefix = q.replace(/[%_]/g, (m) => `\\${m}`) + "%";
  const substr = "%" + q.replace(/[%_]/g, (m) => `\\${m}`) + "%";

  const selectCols =
    "id, sku, brand_name, strength, form, composition";

  // SAFETY (medicine-resolver slice): only APPROVED rows reach a prescribing
  // doctor. Aarogya can auto-add web-verified / strip-read medicines as
  // review_status='pending' — those must never surface in the Rx composer until
  // ops approves them.
  const APPROVED = "approved";

  // Strategy 1 — brand prefix
  const prefixP = supabaseAdmin
    .from("medicine_catalog")
    .select(selectCols)
    .eq("review_status", APPROVED)
    .ilike("brand_name", prefix)
    .order("brand_name", { ascending: true })
    .limit(limit);

  // Strategy 2 — brand substring (catches mid-word matches; the
  // GIN trigram index makes ILIKE %q% fast enough on 854 rows that
  // we don't bother with the `%` similarity operator)
  const brandSubstrP = supabaseAdmin
    .from("medicine_catalog")
    .select(selectCols)
    .eq("review_status", APPROVED)
    .ilike("brand_name", substr)
    .order("brand_name", { ascending: true })
    .limit(limit);

  // Strategy 3 — composition substring
  const compSubstrP = supabaseAdmin
    .from("medicine_catalog")
    .select(selectCols)
    .eq("review_status", APPROVED)
    .ilike("composition", substr)
    .order("brand_name", { ascending: true })
    .limit(limit);

  const [prefixR, brandSubstrR, compSubstrR] = await Promise.all([
    prefixP,
    brandSubstrP,
    compSubstrP,
  ]);
  for (const r of [prefixR, brandSubstrR, compSubstrR]) {
    if (r.error) {
      console.error("[doctor-medicine-search] supabase error:", r.error);
      return NextResponse.json(
        { error: `Search failed: ${r.error.message}` },
        { status: 500 },
      );
    }
  }

  // Merge with ranking. A row that hits strategy N also hits
  // strategy N+1 / N+2 in many cases — dedupe by id, keep the
  // highest score, sort by score desc then brand alphabetical.
  const scoreById = new Map<string, { score: number; row: MedicineRow }>();
  function add(rows: MedicineRow[] | null, score: number) {
    if (!rows) return;
    for (const row of rows) {
      const existing = scoreById.get(row.id);
      if (!existing || existing.score < score) {
        scoreById.set(row.id, { score, row });
      }
    }
  }
  add(prefixR.data as MedicineRow[] | null, 3);
  add(brandSubstrR.data as MedicineRow[] | null, 2);
  add(compSubstrR.data as MedicineRow[] | null, 1);

  const merged = [...scoreById.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.row.brand_name.localeCompare(b.row.brand_name);
    })
    .slice(0, limit)
    .map((entry) => entry.row);

  return NextResponse.json({ results: merged });
}
