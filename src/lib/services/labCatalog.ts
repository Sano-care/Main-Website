// T85 PR4b — Lab Tests Common Tests grid config.
//
// 12 items shown in a 3-row × 4-col grid on the LabBasketWindow:
//   Row 1: 2 Sanocare-branded packages (Essentials, Complete) + 2 individuals
//   Rows 2-3: 8 individual tests
//
// Per founder direction (brief Step 2, point 2):
//   - Packages get a small coral "Popular" badge top-right
//   - Package quantity capped to 1
//   - Individual tests have +/- stepper with no upper cap
//
// Pathcore code references are the SOURCE OF TRUTH for individual
// tests (resolved against `lab_tests` table at runtime). Packages are
// Sanocare-branded synthetic bundles; their `componentCodes` list the
// Pathcore tests that make up the package so ops can resolve them
// downstream.
//
// `scripts/validate-lab-catalog.ts` runs at prebuild and confirms
// every `pathcoreCode` here resolves in the `lab_tests` table. If
// Pathcore rotates a code, the build fails loudly — better than a
// silent grid breakage post-deploy.
//
// MRP (strikethrough) vs Sanocare price — founder finalises both
// before launch. Indicative values below are derived from Pathcore
// price_paise (Sanocare ≈ Pathcore raw; MRP = Pathcore × 1.4 rounded
// to nearest ₹10). Founder edits this file or hands an authoritative
// price sheet for the launch pass.

export type LabCatalogItemKind = "package" | "test";

export interface LabIndividualTest {
  kind: "test";
  /** Stable identifier used by the basket store (matches pathcoreCode for individuals). */
  id: string;
  /** Display name shown on the grid card. */
  name: string;
  /** Pathcore code resolved against `lab_tests` table at runtime. */
  pathcoreCode: string;
  /** MRP for strikethrough display (rupees). */
  mrp: number;
  /** Sanocare price (rupees) — what the patient actually pays. */
  price: number;
}

export interface LabPackage {
  kind: "package";
  id: string;
  name: string;
  /** Short subline shown on the package card (e.g. "6 tests in 1 package"). */
  subline: string;
  /** Pathcore codes that make up this package. Ops resolves these. */
  componentCodes: ReadonlyArray<string>;
  mrp: number;
  price: number;
  /** Show the small coral "Popular" badge (top-right corner). */
  popular?: boolean;
}

export type LabCatalogItem = LabIndividualTest | LabPackage;

// =============================================================================
// 2 Sanocare-branded packages (positions 1 + 2 in Row 1)
// =============================================================================

const SANOCARE_ESSENTIALS: LabPackage = {
  kind: "package",
  id: "SANO-ESSENTIALS",
  name: "Sanocare Essentials Pack",
  subline: "6 tests in 1 package",
  componentCodes: [
    "MD0042", // Complete Blood Count (CBC)
    "BC0334", // Lipid Profile
    "BC0245", // Glucose (Fasting) / FBS
    "BC0340", // Liver Function Test (LFT)
    "BC0317", // Kidney Function Test (KFT)
    "CP0029", // Urine Examination, Routine
  ],
  // Component MRPs at indicative pricing: 560 + 1120 + 140 + 1080 + 1120 + 170 = 4190
  mrp: 4190,
  // Founder bundle discount placeholder — finalised before launch.
  price: 2499,
  popular: true,
};

const SANOCARE_COMPLETE: LabPackage = {
  kind: "package",
  id: "SANO-COMPLETE",
  name: "Sanocare Complete Pack",
  subline: "10 tests in 1 package",
  componentCodes: [
    // Essentials components +
    "MD0042",
    "BC0334",
    "BC0245",
    "BC0340",
    "BC0317",
    "CP0029",
    // Extras for "Complete"
    "BC0514", // Thyroid Profile, Total (T3/T4/TSH)
    "HE0035", // HbA1c
    "BC0560", // Vitamin D 25 Hydroxy
    "BC0552", // Vitamin B12 (Cyanocobalamin)
  ],
  // Component MRPs add Thyroid 840 + HbA1c 770 + VitD 2100 + VitB12 1540 = 5250 extra
  // Essentials 4190 + 5250 = 9440
  mrp: 9440,
  price: 4999,
  popular: true,
};

// =============================================================================
// 10 individual tests (positions 3-12)
// =============================================================================

const INDIVIDUAL_TESTS: ReadonlyArray<LabIndividualTest> = [
  {
    kind: "test",
    id: "MD0042",
    name: "Complete Blood Count (CBC)",
    pathcoreCode: "MD0042",
    mrp: 560,
    price: 400,
  },
  {
    kind: "test",
    id: "BC0334",
    name: "Lipid Profile",
    pathcoreCode: "BC0334",
    mrp: 1120,
    price: 800,
  },
  {
    kind: "test",
    id: "HE0035",
    name: "HbA1c (Diabetes monitoring)",
    pathcoreCode: "HE0035",
    mrp: 770,
    price: 550,
  },
  {
    kind: "test",
    id: "BC0514",
    name: "Thyroid Profile (T3 / T4 / TSH)",
    pathcoreCode: "BC0514",
    mrp: 840,
    price: 600,
  },
  {
    kind: "test",
    id: "BC0340",
    name: "Liver Function Test (LFT)",
    pathcoreCode: "BC0340",
    mrp: 1080,
    price: 770,
  },
  {
    kind: "test",
    id: "BC0317",
    name: "Kidney Function Test (KFT)",
    pathcoreCode: "BC0317",
    mrp: 1120,
    price: 800,
  },
  {
    kind: "test",
    id: "BC0560",
    name: "Vitamin D",
    pathcoreCode: "BC0560",
    mrp: 2100,
    price: 1500,
  },
  {
    kind: "test",
    id: "BC0552",
    name: "Vitamin B12",
    pathcoreCode: "BC0552",
    mrp: 1540,
    price: 1100,
  },
  {
    kind: "test",
    id: "BC0245",
    name: "Fasting Blood Sugar (FBS)",
    pathcoreCode: "BC0245",
    mrp: 140,
    price: 100,
  },
  {
    kind: "test",
    id: "CP0029",
    name: "Urine Routine",
    pathcoreCode: "CP0029",
    mrp: 170,
    price: 120,
  },
];

/**
 * 12 items in the order they render on the grid:
 *   Row 1 (cols 1-4): [Essentials, Complete, CBC, Lipid]
 *   Row 2 (cols 5-8): [HbA1c, Thyroid, LFT, KFT]
 *   Row 3 (cols 9-12): [VitD, VitB12, FBS, Urine]
 */
export const LAB_COMMON_TESTS: ReadonlyArray<LabCatalogItem> = [
  SANOCARE_ESSENTIALS,
  SANOCARE_COMPLETE,
  ...INDIVIDUAL_TESTS,
];

/**
 * Collection fee added to every lab booking grand total. Per founder
 * brief Step 2 point 4: ₹200 at booking. Future-proofed as a
 * constant so a price change is one-line.
 */
export const LAB_COLLECTION_FEE_INR = 200;

/**
 * Flat list of Pathcore codes referenced anywhere in the catalog —
 * fuel for `scripts/validate-lab-catalog.ts` to confirm every code
 * resolves in the `lab_tests` table at build time. Catches rotations
 * before they ship.
 */
export function allReferencedPathcoreCodes(): string[] {
  const codes = new Set<string>();
  for (const item of LAB_COMMON_TESTS) {
    if (item.kind === "test") {
      codes.add(item.pathcoreCode);
    } else {
      for (const c of item.componentCodes) codes.add(c);
    }
  }
  return Array.from(codes);
}
