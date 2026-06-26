// Pure parse + field-mapping for the one-off 1mg catalogue import. The
// operational loader (`scripts/load-1mg-catalog.mjs`) mirrors this logic into
// the transient staging table; this module is the canonical, unit-tested
// reference for the CSV shape + per-row mapping. Kept dependency-free so the
// loader and the test agree on exactly how a raw CSV row becomes a staged row.

export interface ImportRecord {
  brand_name: string;
  composition: string;
  strength: string | null;
  form: string | null;
  pack_size: string | null;
  category: string;
  manufacturer: string | null;
  source: string;
}

/**
 * Minimal RFC4180 parser → array of string[] records. Handles double-quoted
 * fields, embedded commas/newlines, and "" escapes. Trailing blank lines are
 * dropped. (The 1mg export is mostly unquoted, but compositions/manufacturers
 * can carry commas, so a quote-aware parse is the safe choice for 242k rows.)
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      if (record.length > 1 || record[0] !== "") rows.push(record);
      record = [];
    } else field += c;
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    rows.push(record);
  }
  return rows;
}

/** Build a header→index map from the first parsed row. */
export function headerIndex(header: string[]): Record<string, number> {
  return Object.fromEntries(header.map((h, i) => [h.trim(), i]));
}

const clean = (v: string | undefined): string => (v ?? "").trim();
const nullable = (v: string | undefined): string | null => clean(v) || null;

/** Map one raw CSV row to a staging record. Empty strength/form/pack/manufacturer
 *  become NULL; category + source fall back to their dataset defaults. */
export function mapImportRecord(row: string[], idx: Record<string, number>): ImportRecord {
  return {
    brand_name: clean(row[idx.brand_name]),
    composition: clean(row[idx.composition]),
    strength: nullable(row[idx.strength]),
    form: nullable(row[idx.form]),
    pack_size: nullable(row[idx.pack_size]),
    category: clean(row[idx.category]) || "Medicine",
    manufacturer: nullable(row[idx.manufacturer]),
    source: clean(row[idx.source]) || "dataset_1mg",
  };
}

/** A staged row is loadable only if it has both a brand and a composition
 *  (medicine_catalog enforces NOT NULL on both). */
export function isLoadable(r: ImportRecord): boolean {
  return r.brand_name !== "" && r.composition !== "";
}
