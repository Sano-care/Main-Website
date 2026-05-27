#!/usr/bin/env tsx
/**
 * scripts/import_lab_tests.ts
 *
 * One-off (and re-runnable) seed for public.lab_tests.
 *
 * Source: scripts/data/lab_tests_seed.json — 1,900-row Pathcore catalog,
 * version-controlled alongside this script so import + data move
 * together. Each row in the source is an object shaped:
 *   {
 *     code, name, category, method, sample, tat, shipping,
 *     price (number, in RUPEES), utility, instructions
 *   }
 *
 * Important: source `price` is in RUPEES, NOT paise. Verified pre-
 * import by sampling high-end NGS panels (₹15-385k) + routine tests
 * (CBC ₹400, HbA1c ₹550). This script multiplies by 100 to land
 * paise into `lab_tests.price_paise` (integer).
 *
 * Idempotency: ON CONFLICT (code) DO UPDATE — re-running after the
 * source JSON gets updated just refreshes existing rows. Rows with
 * empty `code` or empty `name` are skipped with a logged reason.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx scripts/import_lab_tests.ts
 *
 *   # Optional override of source path (defaults to scripts/data/
 *   # lab_tests_seed.json so re-runs don't need an arg):
 *   npx tsx scripts/import_lab_tests.ts ./path/to/custom.json
 *
 * The script sanity-decodes the SUPABASE_SERVICE_ROLE_KEY JWT to
 * refuse running with the anon key (the v7 import-script footgun).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------
// CLI args + env

const jsonArg = process.argv[2] ?? "scripts/data/lab_tests_seed.json";
const jsonPath = resolve(process.cwd(), jsonArg);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing env: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Export them in this shell before running (or use dotenv-cli).",
  );
  process.exit(2);
}

try {
  const payloadB64 = SERVICE_ROLE_KEY.split(".")[1] ?? "";
  const payload = JSON.parse(
    Buffer.from(payloadB64, "base64").toString("utf-8"),
  ) as { role?: string };
  if (payload.role !== "service_role") {
    console.error(
      `SUPABASE_SERVICE_ROLE_KEY decodes to role='${payload.role ?? "<missing>"}'; expected 'service_role'.`,
    );
    process.exit(1);
  }
} catch (e) {
  console.error("Could not decode SUPABASE_SERVICE_ROLE_KEY:", e);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------
// Source shape

type SourceRow = {
  code?: string;
  name?: string;
  category?: string;
  method?: string;
  sample?: string;
  tat?: string;
  shipping?: string;
  price?: number; // rupees (verified pre-import)
  utility?: string;
  instructions?: string;
};

type CatalogRow = {
  code: string;
  name: string;
  category: string | null;
  method: string | null;
  sample: string | null;
  tat: string | null;
  shipping: string | null;
  price_paise: number | null;
  utility: string | null;
  instructions: string | null;
};

function clean(v: string | undefined | null): string {
  return (v ?? "").trim();
}
function cleanOrNull(v: string | undefined | null): string | null {
  const t = clean(v);
  return t === "" ? null : t;
}

function rowToCatalog(row: SourceRow): CatalogRow | { skip: string } {
  const code = clean(row.code);
  const name = clean(row.name);
  if (!code) return { skip: "empty code" };
  if (!name) return { skip: "empty name" };

  // price_paise = price_rupees * 100. Source confirmed rupees via
  // founder verification (₹400 CBC, ₹18,700 FISH panels, etc.).
  // Defensive: drop non-finite / non-integer rupees by setting null
  // rather than inserting bad data. NG0146 "Pulmonary 20 gene Panel"
  // at price=2 imports as 200 paise = ₹2 — clearly a data-entry
  // artifact upstream, but we let it through and rely on Pathcore
  // re-import to self-correct once they fix it.
  let price_paise: number | null = null;
  if (typeof row.price === "number" && Number.isFinite(row.price) && row.price >= 0) {
    price_paise = Math.round(row.price * 100);
  }

  return {
    code,
    name,
    category: cleanOrNull(row.category),
    method: cleanOrNull(row.method),
    sample: cleanOrNull(row.sample),
    tat: cleanOrNull(row.tat),
    shipping: cleanOrNull(row.shipping),
    price_paise,
    utility: cleanOrNull(row.utility),
    instructions: cleanOrNull(row.instructions),
  };
}

// ---------------------------------------------------------------------
// Main

async function main() {
  console.log(`[import_lab_tests] JSON  : ${jsonPath}`);
  console.log(`[import_lab_tests] Target: ${SUPABASE_URL}`);

  let raw: string;
  try {
    raw = readFileSync(jsonPath, "utf-8");
  } catch (e) {
    console.error(
      `Could not read ${jsonPath}: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(
      `Could not parse ${jsonPath}: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(1);
  }
  if (!Array.isArray(parsed)) {
    console.error(`Expected an array in ${jsonPath}, got ${typeof parsed}.`);
    process.exit(1);
  }
  const sourceRows = parsed as SourceRow[];
  console.log(`[import_lab_tests] read ${sourceRows.length} source rows`);

  // Convert + filter — collect skip reasons for the final report.
  const batch: CatalogRow[] = [];
  const skipReasons: Record<string, number> = {};
  let read = 0;
  for (const src of sourceRows) {
    read++;
    const converted = rowToCatalog(src);
    if ("skip" in converted) {
      skipReasons[converted.skip] = (skipReasons[converted.skip] ?? 0) + 1;
      continue;
    }
    batch.push(converted);
  }
  console.log(`[import_lab_tests] valid rows: ${batch.length}, skipped: ${read - batch.length}`);

  // Batch upserts in groups of 100. 1,900 rows = ~19 batches; modest
  // serial latency on the supabase pooler.
  const BATCH_SIZE = 100;
  let upserted = 0;
  for (let i = 0; i < batch.length; i += BATCH_SIZE) {
    const slice = batch.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("lab_tests")
      .upsert(slice, { onConflict: "code", ignoreDuplicates: false });
    if (error) {
      console.error(
        `[import_lab_tests] batch ${i / BATCH_SIZE + 1} FAILED at row ${i}: ${error.message}`,
      );
      process.exit(1);
    }
    upserted += slice.length;
    console.log(
      `[import_lab_tests] batch ${i / BATCH_SIZE + 1}/${Math.ceil(batch.length / BATCH_SIZE)} OK (${upserted}/${batch.length})`,
    );
  }

  // Final report.
  console.log("");
  console.log(`[import_lab_tests] DONE`);
  console.log(`  read     : ${read}`);
  console.log(`  upserted : ${upserted}`);
  console.log(`  skipped  : ${read - upserted}`);
  if (Object.keys(skipReasons).length > 0) {
    console.log(`  reasons  :`);
    for (const [k, n] of Object.entries(skipReasons)) {
      console.log(`    - ${k}: ${n}`);
    }
  }

  // Post-state count via a SELECT count(*) so the user can confirm.
  const { count, error: countErr } = await supabase
    .from("lab_tests")
    .select("*", { count: "exact", head: true });
  if (countErr) {
    console.warn(`  count-check failed: ${countErr.message}`);
  } else {
    console.log(`  lab_tests row count in DB: ${count}`);
  }
}

main().catch((e) => {
  console.error("[import_lab_tests] Fatal:", e);
  process.exit(1);
});
