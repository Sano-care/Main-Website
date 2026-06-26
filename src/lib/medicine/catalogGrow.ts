// Catalogue self-growth — insert a verified-but-new medicine as a PENDING row.
//
// A medicine that is web-verified (patient-confirmed) or read off a strip and
// NOT already in medicine_catalog gets inserted with review_status='pending' +
// provenance. Pending rows are invisible to the doctor prescriber search (the
// doctor route filters review_status='approved') until ops approves them.
// Idempotent: matches an existing row on normalised brand+composition.

import { supabaseAdmin } from "@/lib/supabase-server";

export interface AddPendingInput {
  brandName: string;
  composition: string;
  strength?: string | null;
  form?: string | null;
  source: "aarogya_web" | "aarogya_strip";
  customerId: string | null;
  /** Citation URL (web) or 'strip_photo' (vision). */
  verifiedSource: string;
}

export interface AddPendingResult {
  added: boolean;
  id: string | null;
  reason?: "missing_fields" | "exists" | "insert_failed";
}

export interface CatalogGrowDeps {
  supabase?: typeof supabaseAdmin;
}

export async function addPendingMedicine(
  input: AddPendingInput,
  deps: CatalogGrowDeps = {},
): Promise<AddPendingResult> {
  const supabase = deps.supabase ?? supabaseAdmin;
  const brand = input.brandName.trim();
  const composition = input.composition.trim();
  if (!brand || !composition) return { added: false, id: null, reason: "missing_fields" };

  // Idempotent — never double-insert the same medicine (any review_status).
  const { data: existing } = await supabase
    .from("medicine_catalog")
    .select("id")
    .ilike("brand_name", brand)
    .ilike("composition", composition)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return { added: false, id: (existing as { id: string }).id, reason: "exists" };
  }

  const { data, error } = await supabase
    .from("medicine_catalog")
    .insert({
      brand_name: brand,
      composition,
      strength: input.strength ?? null,
      form: input.form ?? null,
      source: input.source,
      review_status: "pending",
      added_by_customer_id: input.customerId,
      verified_source: input.verifiedSource,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[addPendingMedicine] insert failed:", error.message);
    return { added: false, id: null, reason: "insert_failed" };
  }
  return { added: true, id: (data as { id: string } | null)?.id ?? null };
}
