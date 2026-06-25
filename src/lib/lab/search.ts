// Lab catalogue search — the SINGLE source of truth for the patient-facing
// lab_tests query. Both /api/lab/search (website basket, T85 PR4b) and Aarogya's
// search_lab_tests tool call this, so chat results match the website exactly.
//
// Ranking is the 4-strategy ILIKE the website route already shipped (prefix-name,
// prefix-code, substring-name, category), NOT FTS over search_vector — the brief
// assumed FTS, but the live route uses ILIKE. Mirrored here verbatim. Read-only.

import { supabaseAdmin } from "@/lib/supabase-server";

export interface LabTestSearchRow {
  code: string;
  name: string;
  /** Customer-facing price in paise; nullable (5 catalogue rows have no price). */
  price_paise: number | null;
  sample: string | null;
  tat: string | null;
  category: string | null;
  utility: string | null;
}

const MIN_QUERY_LEN = 2;
const MAX_LIMIT = 25;

export async function runLabTestSearch(
  rawQuery: string,
  opts: { limit?: number; supabase?: typeof supabaseAdmin } = {},
): Promise<LabTestSearchRow[]> {
  const q = (rawQuery ?? "").trim();
  if (q.length < MIN_QUERY_LEN) return []; // "" / "a" would match ~everything
  const supabase = opts.supabase ?? supabaseAdmin;
  const limit = Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? 12));

  // Escape ILIKE wildcards in user input so "a%b" is literal.
  const ilikeQ = q.replace(/[%_]/g, "\\$&");
  const { data, error } = await supabase
    .from("lab_tests")
    .select("code, name, price_paise, sample, tat, category, utility")
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
    console.error("[lab/search] query failed:", error.message);
    return [];
  }
  return (data ?? []) as LabTestSearchRow[];
}
