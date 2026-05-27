import { NextRequest, NextResponse } from "next/server";
import { getCurrentDoctorSession } from "@/app/doctor/_lib/getCurrentDoctor";
import { supabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/doctor/lab-tests/search?q=<query>&limit=12
 *
 * Returns up to `limit` (default 12, max 50) lab_tests rows ranked by
 * relevance to the doctor's typed query.
 *
 * Mirrors /api/doctor/medicines/search exactly modulo lab-specific
 * fields. The four strategies, in priority order:
 *
 *   1. name ILIKE 'query%'           (prefix match, score 4)
 *   2. code ILIKE 'query%'           (Pathcore code prefix, score 3)
 *   3. name ILIKE '%query%'          (mid-name substring, score 2)
 *   4. category ILIKE '%query%'      (category match, score 1)
 *
 * Strategy 5 — full-text via search_vector @@ to_tsquery — is
 * available behind the GIN index but isn't part of the ORDER BY
 * here; the trigram + prefix strategies cover enough surface area
 * for name/code free-typing that adding tsvector ranking just muddies
 * the result order. The search_vector indexes utility + sample +
 * other clinical text, which is overkill for "find a lab test by
 * name or Pathcore code" — the dominant doctor workflow.
 *
 * Auth: gated by the C1 doctor session cookie (same posture as
 * /api/doctor/medicines/search). Service-role Supabase client used
 * for the query; the SELECT policy on the table is open USING (true)
 * so either client works, but we use the admin client for consistency
 * with the rest of /api/doctor/*.
 *
 * Response:
 *   200 { results: [{ id, code, name, category, method, sample, tat,
 *                     price_paise, instructions }, …] }
 *   401 { error }   — no/invalid/expired doctor session
 *   400 { error }   — query too long
 *   500 { error }   — supabase error
 *
 * Empty / too-short queries (< 2 chars) short-circuit to `{ results: [] }`
 * so the autocomplete UI can throttle keystrokes without juggling error
 * states.
 */

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 12;
const MIN_QUERY_LEN = 2;
const MAX_QUERY_LEN = 80;

type LabTestRow = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  method: string | null;
  sample: string | null;
  tat: string | null;
  price_paise: number | null;
  instructions: string | null;
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

  // Escape ILIKE special characters so a query like "100%" or "BC_01"
  // doesn't accidentally match-all / single-char-wildcard.
  const prefix = q.replace(/[%_]/g, (m) => `\\${m}`) + "%";
  const substr = "%" + q.replace(/[%_]/g, (m) => `\\${m}`) + "%";

  const selectCols =
    "id, code, name, category, method, sample, tat, price_paise, instructions";

  // Strategy 1 — name prefix (most common: doctor types "Lipid"
  // → wants "Lipid Profile" first).
  const namePrefixP = supabaseAdmin
    .from("lab_tests")
    .select(selectCols)
    .ilike("name", prefix)
    .order("name", { ascending: true })
    .limit(limit);

  // Strategy 2 — code prefix (doctor knows the Pathcore code, e.g.
  // "BC0573" → wants the exact row first).
  const codePrefixP = supabaseAdmin
    .from("lab_tests")
    .select(selectCols)
    .ilike("code", prefix)
    .order("code", { ascending: true })
    .limit(limit);

  // Strategy 3 — name substring (mid-word matches: doctor types
  // "vitamin" → wants "Comprehensive Vitamin Panel" etc.). Cheap on
  // the GIN trigram index.
  const nameSubstrP = supabaseAdmin
    .from("lab_tests")
    .select(selectCols)
    .ilike("name", substr)
    .order("name", { ascending: true })
    .limit(limit);

  // Strategy 4 — category match (broad: "oncology" → all the
  // oncology panels). Lowest weight so name + code matches win.
  const categorySubstrP = supabaseAdmin
    .from("lab_tests")
    .select(selectCols)
    .ilike("category", substr)
    .order("name", { ascending: true })
    .limit(limit);

  const [namePrefixR, codePrefixR, nameSubstrR, categorySubstrR] =
    await Promise.all([
      namePrefixP,
      codePrefixP,
      nameSubstrP,
      categorySubstrP,
    ]);
  for (const r of [namePrefixR, codePrefixR, nameSubstrR, categorySubstrR]) {
    if (r.error) {
      console.error("[doctor-lab-test-search] supabase error:", r.error);
      return NextResponse.json(
        { error: `Search failed: ${r.error.message}` },
        { status: 500 },
      );
    }
  }

  // Merge with ranking. A row that hits strategy N also hits N+1 in
  // many cases — dedupe by id, keep highest score, sort by score
  // desc then name alphabetical.
  const scoreById = new Map<string, { score: number; row: LabTestRow }>();
  function add(rows: LabTestRow[] | null, score: number) {
    if (!rows) return;
    for (const row of rows) {
      const existing = scoreById.get(row.id);
      if (!existing || existing.score < score) {
        scoreById.set(row.id, { score, row });
      }
    }
  }
  add(namePrefixR.data as LabTestRow[] | null, 4);
  add(codePrefixR.data as LabTestRow[] | null, 3);
  add(nameSubstrR.data as LabTestRow[] | null, 2);
  add(categorySubstrR.data as LabTestRow[] | null, 1);

  const merged = [...scoreById.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.row.name.localeCompare(b.row.name);
    })
    .slice(0, limit)
    .map((entry) => entry.row);

  return NextResponse.json({ results: merged });
}
