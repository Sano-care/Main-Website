#!/usr/bin/env tsx
/**
 * scripts/import_medicine_catalog.ts
 *
 * One-off (and re-runnable) seed for public.medicine_catalog.
 *
 * Usage:
 *   npx tsx scripts/import_medicine_catalog.ts <path-to-csv>
 *
 * Requires the following env vars (load via dotenv-cli or
 * inline `export`; the script does not source .env on its own):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * CSV expectations (columns, in any order — header row required):
 *   SKU
 *   Medicine Name
 *   Strength
 *   Form
 *   Pack Size
 *   Category
 *   Composition
 *
 * Idempotency: ON CONFLICT (sku) DO UPDATE — re-running after the
 * source CSV gets updated just refreshes the existing rows. Rows
 * with empty `Medicine Name` or empty `Composition` are skipped
 * with a logged reason (M025's NOT NULL constraints would reject
 * them anyway).
 *
 * Stream-parse (csv-parse's async iterator). 854 rows is small
 * enough to load entirely, but the streaming pattern is cleaner
 * and survives a 10x catalog growth without code changes.
 */

import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { parse as csvParse } from "csv-parse";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------
const csvArg = process.argv[2];
if (!csvArg) {
  console.error(
    "Usage: npx tsx scripts/import_medicine_catalog.ts <path-to-csv>",
  );
  process.exit(2);
}
const csvPath = resolve(process.cwd(), csvArg);

// ---------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing env: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Export them in this shell before running (or use dotenv-cli).",
  );
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
type CsvRow = Record<string, string>;
type CatalogRow = {
  sku: number | null;
  brand_name: string;
  strength: string | null;
  form: string | null;
  pack_size: string | null;
  category: string;
  composition: string;
};

function clean(v: string | undefined): string {
  return (v ?? "").trim();
}
function cleanOrNull(v: string | undefined): string | null {
  const t = clean(v);
  return t === "" ? null : t;
}
function parseSku(v: string | undefined): number | null {
  const t = clean(v);
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

function rowToCatalog(row: CsvRow): CatalogRow | { skip: string } {
  const brand_name = clean(row["Medicine Name"]);
  const composition = clean(row["Composition"]);
  if (!brand_name) return { skip: "empty Medicine Name" };
  if (!composition) return { skip: "empty Composition" };
  return {
    sku: parseSku(row["SKU"]),
    brand_name,
    strength: cleanOrNull(row["Strength"]),
    form: cleanOrNull(row["Form"]),
    pack_size: cleanOrNull(row["Pack Size"]),
    category: cleanOrNull(row["Category"]) ?? "Medicine",
    composition,
  };
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------
async function main() {
  console.log(`[import] CSV   : ${csvPath}`);
  console.log(`[import] Target: ${SUPABASE_URL}`);

  const parser = createReadStream(csvPath).pipe(
    csvParse({
      columns: true,         // first row → keys
      bom: true,             // strip BOM if present (Excel-exported CSVs)
      skip_empty_lines: true,
      trim: true,
    }),
  );

  let read = 0;
  let skipped = 0;
  let upserted = 0;
  const skipReasons: Record<string, number> = {};

  // Batch upserts in groups of 100 for fewer round-trips. 854 rows
  // gives ~9 round-trips total.
  const BATCH = 100;
  let batch: CatalogRow[] = [];

  async function flushBatch() {
    if (batch.length === 0) return;
    const { error } = await supabase
      .from("medicine_catalog")
      .upsert(batch, { onConflict: "sku", ignoreDuplicates: false });
    if (error) {
      console.error(
        `[import] upsert failed at batch starting sku=${batch[0]?.sku}:`,
        error.message,
      );
      throw error;
    }
    upserted += batch.length;
    batch = [];
  }

  for await (const row of parser as AsyncIterable<CsvRow>) {
    read++;
    const result = rowToCatalog(row);
    if ("skip" in result) {
      skipped++;
      skipReasons[result.skip] = (skipReasons[result.skip] ?? 0) + 1;
      continue;
    }
    batch.push(result);
    if (batch.length >= BATCH) {
      await flushBatch();
      process.stdout.write(`\r[import] upserted=${upserted} skipped=${skipped} read=${read}`);
    }
  }
  await flushBatch();

  process.stdout.write("\n");
  console.log(`[import] done. read=${read} upserted=${upserted} skipped=${skipped}`);
  if (Object.keys(skipReasons).length > 0) {
    console.log(`[import] skip reasons:`, skipReasons);
  }

  // Sanity read-back.
  const { count, error: countErr } = await supabase
    .from("medicine_catalog")
    .select("*", { count: "exact", head: true });
  if (countErr) {
    console.error("[import] post-import count failed:", countErr.message);
  } else {
    console.log(`[import] medicine_catalog row count = ${count}`);
  }
}

main().catch((err) => {
  console.error("[import] FAILED:", err);
  process.exit(1);
});
