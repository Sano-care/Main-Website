// Canonical 1mg-import parse + field mapping (mirrored by the one-off loader
// scripts/load-1mg-catalog.mjs). The full load ran against the real
// 241,925-row CSV; these lock the row-shape contract.

import { describe, expect, it } from "vitest";

import {
  parseCsv,
  headerIndex,
  mapImportRecord,
  isLoadable,
} from "@/lib/medicine/import1mg";

const HEADER = "brand_name,composition,strength,form,pack_size,category,manufacturer,source";

describe("parseCsv", () => {
  it("parses plain rows (the common 1mg shape — no quoting)", () => {
    const rows = parseCsv(
      `${HEADER}\nAzithral 500 Tablet,Azithromycin (500mg),,Tablet,strip of 5 tablets,Medicine,Alembic Pharmaceuticals Ltd,dataset_1mg\n`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe("Azithral 500 Tablet");
    expect(rows[1][2]).toBe(""); // empty strength
    expect(rows[1][7]).toBe("dataset_1mg");
  });

  it("honours quoted fields with embedded commas + escaped quotes", () => {
    const rows = parseCsv(
      `${HEADER}\n"Brand, Forte","A (1mg), B (2mg)",,Tablet,"strip of 10",Medicine,"Acme, Inc","dataset_1mg"\n`,
    );
    expect(rows[1][0]).toBe("Brand, Forte");
    expect(rows[1][1]).toBe("A (1mg), B (2mg)");
    expect(rows[1][6]).toBe("Acme, Inc");
  });

  it("drops blank trailing lines, keeps every data row", () => {
    const rows = parseCsv(`${HEADER}\nA,c1,,Tablet,p,Medicine,m,dataset_1mg\n\n`);
    expect(rows).toHaveLength(2);
  });
});

describe("mapImportRecord", () => {
  const idx = headerIndex(HEADER.split(","));

  it("maps a full row, NULLing empty optional fields", () => {
    const [row] = parseCsv(
      "Augmentin 625 Duo Tablet,Amoxycillin (500mg) + Clavulanic Acid (125mg),,Tablet,strip of 10 tablets,Medicine,Glaxo SmithKline Pharmaceuticals Ltd,dataset_1mg",
    );
    expect(mapImportRecord(row, idx)).toEqual({
      brand_name: "Augmentin 625 Duo Tablet",
      composition: "Amoxycillin (500mg) + Clavulanic Acid (125mg)",
      strength: null, // empty in the dataset
      form: "Tablet",
      pack_size: "strip of 10 tablets",
      category: "Medicine",
      manufacturer: "Glaxo SmithKline Pharmaceuticals Ltd",
      source: "dataset_1mg",
    });
  });

  it("falls back category→'Medicine' and source→'dataset_1mg' when blank", () => {
    const [row] = parseCsv("X,c1,,,,,,");
    const rec = mapImportRecord(row, idx);
    expect(rec.category).toBe("Medicine");
    expect(rec.source).toBe("dataset_1mg");
    expect(rec.form).toBeNull();
    expect(rec.manufacturer).toBeNull();
  });
});

describe("isLoadable", () => {
  const idx = headerIndex(HEADER.split(","));
  const rec = (csv: string) => mapImportRecord(parseCsv(csv)[0], idx);

  it("requires both brand and composition (medicine_catalog NOT NULLs)", () => {
    expect(isLoadable(rec("Brand,Comp,,Tablet,p,Medicine,m,dataset_1mg"))).toBe(true);
    expect(isLoadable(rec(",Comp,,Tablet,p,Medicine,m,dataset_1mg"))).toBe(false);
    expect(isLoadable(rec("Brand,,,Tablet,p,Medicine,m,dataset_1mg"))).toBe(false);
  });
});
