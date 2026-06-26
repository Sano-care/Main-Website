// One-off bulk loader for the 1mg medicine dataset (~241,925 rows) → the
// transient `medicine_import_1mg_staging` table. The dedupe + non-colliding sku
// assignment (1,000,000 + row_number) + insert into medicine_catalog runs as a
// separate SQL transform AFTER this populates staging (see the PR description).
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/load-1mg-catalog.mjs <path-to-csv>
//
// Idempotency: TRUNCATE the staging table before re-running. This script only
// writes to staging — it never touches medicine_catalog directly.
//
// The parse + per-row mapping below mirrors the unit-tested canonical reference
// at src/lib/medicine/import1mg.ts (kept in sync; the test there locks the
// CSV/row-shape contract this loader relies on).

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const CSV_PATH = process.argv[2];
const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STAGING = "medicine_import_1mg_staging";
const BATCH = 1000;

if (!CSV_PATH) throw new Error("usage: node load-1mg-catalog.mjs <csv-path>");
if (!URL || !KEY) throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");

/** Minimal RFC4180 parser → array of string[] records (handles quoted fields,
 *  embedded commas, and "" escapes). */
function parseCsv(text) {
  const rows = [];
  let field = "";
  let record = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field); field = "";
      // Skip blank trailing lines.
      if (record.length > 1 || record[0] !== "") rows.push(record);
      record = [];
    } else field += c;
  }
  if (field !== "" || record.length > 0) { record.push(field); rows.push(record); }
  return rows;
}

const raw = readFileSync(CSV_PATH, "utf8");
const rows = parseCsv(raw);
const header = rows[0];
const dataRows = rows.slice(1);
console.log(`parsed ${dataRows.length} data rows; header: ${header.join("|")}`);

const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
const recordOf = (r) => ({
  brand_name: (r[idx.brand_name] ?? "").trim(),
  composition: (r[idx.composition] ?? "").trim(),
  strength: (r[idx.strength] ?? "").trim() || null,
  form: (r[idx.form] ?? "").trim() || null,
  pack_size: (r[idx.pack_size] ?? "").trim() || null,
  category: (r[idx.category] ?? "").trim() || "Medicine",
  manufacturer: (r[idx.manufacturer] ?? "").trim() || null,
  source: (r[idx.source] ?? "").trim() || "dataset_1mg",
});

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

let inserted = 0;
for (let i = 0; i < dataRows.length; i += BATCH) {
  const batch = dataRows.slice(i, i + BATCH).map(recordOf).filter((r) => r.brand_name && r.composition);
  const { error } = await supabase.from(STAGING).insert(batch);
  if (error) throw new Error(`batch @${i} failed: ${error.message}`);
  inserted += batch.length;
  if ((i / BATCH) % 20 === 0) console.log(`  inserted ${inserted}/${dataRows.length}`);
}
console.log(`DONE — ${inserted} rows into ${STAGING}`);
