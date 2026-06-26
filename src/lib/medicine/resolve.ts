// Catalogue resolver — typo-tolerant medicine lookup against medicine_catalog.
//
// Reuses the doctor-search posture (prefix + composition) PLUS a pg_trgm
// word_similarity() strategy for misspellings, via the resolve_medicine_catalog
// RPC (approved rows only). brand_name carries pack/form suffixes
// ("Shelgut Capsule 10's"), so full-string similarity() is too diluted —
// word_similarity (best contiguous word-extent) is the right metric.

import { supabaseAdmin } from "@/lib/supabase-server";

export interface MedicineCandidate {
  id: string;
  brand_name: string;
  strength: string | null;
  form: string | null;
  composition: string;
  score: number;
}

/** Confidence bands on the RPC's normalised 0..1 score. */
export const CONFIDENCE_HIGH = 0.6; // single confident hit → confirm directly
export const CONFIDENCE_FLOOR = 0.3; // below the RPC floor the catalogue has nothing useful

export interface ResolveDeps {
  supabase?: Pick<typeof supabaseAdmin, "rpc">;
  limit?: number;
}

export async function resolveMedicineCatalog(
  rawQuery: string,
  deps: ResolveDeps = {},
): Promise<MedicineCandidate[]> {
  const q = (rawQuery ?? "").trim().replace(/[%_]/g, " ").replace(/\s+/g, " ").trim();
  if (q.length < 2) return [];
  const supabase = deps.supabase ?? supabaseAdmin;
  const max_n = Math.min(10, Math.max(1, deps.limit ?? 5));

  const { data, error } = await supabase.rpc("resolve_medicine_catalog", { q, max_n });
  if (error) {
    console.error("[resolveMedicineCatalog] rpc error:", error.message);
    return [];
  }
  return (data ?? []) as MedicineCandidate[];
}

/** Classify a candidate list into a resolution decision the executor acts on. */
export type ResolveOutcome =
  | { kind: "confident"; top: MedicineCandidate }
  | { kind: "ambiguous"; candidates: MedicineCandidate[] }
  | { kind: "none" };

export function classifyCandidates(candidates: MedicineCandidate[]): ResolveOutcome {
  if (candidates.length === 0) return { kind: "none" };
  const top = candidates[0];
  if (top.score >= CONFIDENCE_HIGH && (candidates.length === 1 || candidates[1].score < top.score)) {
    return { kind: "confident", top };
  }
  if (top.score >= CONFIDENCE_FLOOR) {
    return { kind: "ambiguous", candidates: candidates.slice(0, 3) };
  }
  return { kind: "none" };
}
