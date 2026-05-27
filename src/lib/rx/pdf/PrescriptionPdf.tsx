// React-PDF document for a single Rx version (v3 visual template).
//
// The same component drives:
//   - the server-side final render (renderPrescriptionPdf.ts ->
//     @react-pdf/renderer renderToBuffer), invoked from
//     sendPrescription() in the doctor server actions, with
//     signatureMode='embedded' and signatureDataUrl set
//   - the doctor-side preview during composition, with
//     signatureMode='placeholder' (no embedded image — just a
//     placeholder line)
//
// Cormorant Garamond, Source Serif 4, and Inter are registered at the
// module level via the helpers in renderPrescriptionPdf.ts; this file
// does NOT re-register fonts (so it can be imported in a context where
// the TTFs aren't on disk).
//
// Layout: A4 portrait, single column, cream paper (#FBF8F1), navy ink
// (#0A2670). Inset double-rule frame at 8mm/10mm from page edge.
// Watermark Sanocare logo at 4.5% opacity behind content. Six-cell
// vitals grid, two-up clinical row, medications table with composition
// under each drug name, two-up investigations + advice block, signature
// row with stamp placeholder (or embedded stamp image if uploaded),
// corporate footer with QR code, and control + compliance strips.
//
// Stamp handling mirrors signature handling exactly — see F2 in the
// v3 brief and the stampMode/stampDataUrl props below.

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  Svg,
  Path,
} from "@react-pdf/renderer";

// -------- types --------------------------------------------------------

export type PrescriptionItemForPdf = {
  ordinal: number;
  drug_name: string;
  /** Optional generic composition string (from medicine_catalog when
   *  the row was picked from autocomplete; null for free-text rows). */
  composition: string | null;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
};

export type PrescriptionLabTestForPdf = {
  ordinal: number;
  test_name: string;
  instructions: string | null;
};

export type PrescriptionPdfData = {
  // Header / identity
  prescription_code: string;
  version: number;
  sent_at_iso: string | null; // null when previewing a draft

  // Doctor block
  doctor_full_name: string;
  doctor_qualification: string | null;
  doctor_registration_no: string | null;
  /** e.g. "U.P. Medical Council" — printed alongside reg. no. */
  doctor_issuing_council: string | null;

  // Patient snapshot (denormalised at draft time)
  patient_name: string;
  patient_age: number | null;
  patient_sex: "M" | "F" | "O" | "U" | null;
  patient_weight_kg: number | null;

  // Cross-record identifiers
  /** customers.customer_code (SAN-C-XXXXX) — printed as "Patient ID". */
  patient_code: string | null;
  /** bookings.booking_code (SAN-B-XXXXX). */
  booking_code: string | null;
  /** Display string for "Consult mode" — e.g. "Video (Daily.co)".
   *  Derived from consultation_sessions.modality at draft time. */
  consult_mode: string | null;

  // Vitals (all nullable; rendered as "—" when null, bounded in M026)
  bp_sys: number | null;
  bp_dia: number | null;
  pulse_bpm: number | null;
  spo2_pct: number | null;
  temp_c: number | null;
  height_cm: number | null;

  // Clinical body
  chief_complaint: string | null;
  provisional_diagnosis: string | null;
  items: PrescriptionItemForPdf[];
  lab_tests: PrescriptionLabTestForPdf[];
  general_advice: string | null;
  follow_up_advice: string | null;

  /** Data URL of the verification QR code, generated server-side in
   *  renderPrescriptionPdf.ts. Null for previews; populated for sends. */
  qr_data_url: string | null;
};

export type PrescriptionPdfProps = {
  data: PrescriptionPdfData;
  /**
   * 'placeholder' renders an underline + "Doctor's signature" caption
   * (used by the composer preview, where the signed asset is sensitive
   * and we don't want to expose it).
   *
   * 'embedded' renders signatureDataUrl as an <Image>. The send-time
   * server render uses this with the doctor's signature_image_url
   * resolved to a base64 data URL.
   */
  signatureMode: "placeholder" | "embedded";
  /**
   * Required when signatureMode='embedded'. Either a data: URL
   * (base64-encoded PNG / JPG, what renderPrescriptionPdf.ts produces)
   * or a public HTTP URL. Ignored when signatureMode='placeholder'.
   */
  signatureDataUrl?: string | null;
  /**
   * F2: stamp handling mirrors signature handling. 'placeholder'
   * renders a dashed navy circle with "SANOCARE / CLINIC SEAL /
   * awaiting upload"; 'embedded' renders stampDataUrl as an <Image>.
   * For doctors who haven't uploaded a stamp_image_url yet the call
   * site should pass 'placeholder'.
   */
  stampMode: "placeholder" | "embedded";
  stampDataUrl?: string | null;
};

// -------- palette -----------------------------------------------------

const PALETTE = {
  paper: "#FBF8F1",
  ink: "#0F172A",
  inkSoft: "#475569",
  inkMute: "#94A3B8",
  navy: "#0A2670",
  navySoft: "#134CB0",
  rule: "#C9B991", // warm gold-cream rule
  ruleSoft: "#E6DCC2",
  hair: "#D9D2C2",
  blue: "#2B81FF", // Sanocare brand blue (logo, accents)
} as const;

// -------- styling ------------------------------------------------------
// pt-units throughout. 1mm ≈ 2.83465pt.

const styles = StyleSheet.create({
  page: {
    fontFamily: "SourceSerif4",
    fontSize: 10,
    color: PALETTE.ink,
    backgroundColor: PALETTE.paper,
    paddingTop: 56, // ≈ 20mm
    paddingBottom: 56,
    paddingLeft: 56,
    paddingRight: 56,
    lineHeight: 1.45,
    position: "relative",
  },

  // ----- inset double-rule frame (fixed; renders on every page)
  frameOuter: {
    position: "absolute",
    top: 23, // ≈ 8mm from page edge
    left: 23,
    right: 23,
    bottom: 23,
    borderWidth: 0.8,
    borderColor: PALETTE.navy,
  },
  frameInner: {
    position: "absolute",
    top: 28, // ≈ 10mm
    left: 28,
    right: 28,
    bottom: 28,
    borderWidth: 0.3,
    borderColor: PALETTE.rule,
  },

  // ----- watermark (centered Sanocare mark at 4.5% opacity)
  watermarkWrap: {
    position: "absolute",
    top: "30%",
    left: "20%",
    right: "20%",
    bottom: "30%",
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.045,
  },

  // ----- DRAFT watermark text (only on previews)
  draftStamp: {
    position: "absolute",
    top: "45%",
    left: 0,
    right: 0,
    textAlign: "center",
    fontFamily: "CormorantGaramond",
    fontSize: 90,
    color: PALETTE.navy,
    opacity: 0.08,
    fontWeight: 700,
    letterSpacing: 6,
  },

  // ----- LETTERHEAD
  letterhead: {
    alignItems: "center",
    paddingBottom: 12,
  },
  clinicName: {
    fontFamily: "CormorantGaramond",
    fontSize: 26,
    fontWeight: 700,
    color: PALETTE.navy,
    letterSpacing: 5,
    textAlign: "center",
  },
  clinicSubtitle: {
    fontFamily: "SourceSerif4",
    fontSize: 9.5,
    fontStyle: "italic",
    color: PALETTE.inkSoft,
    letterSpacing: 1.5,
    marginTop: 4,
    textAlign: "center",
  },
  identityStrip: {
    fontFamily: "Inter",
    fontSize: 7.5,
    color: PALETTE.inkSoft,
    letterSpacing: 0.8,
    marginTop: 8,
    textAlign: "center",
  },
  identityDivider: { color: PALETTE.rule },

  // ----- decorative ornament (line · dot · diamond · dot · line)
  ornamentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    gap: 10,
  },
  ornamentLine: {
    height: 0.6,
    width: 100,
    backgroundColor: PALETTE.rule,
  },
  ornamentDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: PALETTE.navy,
  },
  ornamentDiamond: {
    width: 6,
    height: 6,
    backgroundColor: PALETTE.navy,
    transform: "rotate(45deg)",
  },

  // ----- DOCUMENT META (top/bottom hairline rules; 3-col)
  docMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderTopWidth: 0.4,
    borderTopColor: PALETTE.hair,
    borderBottomWidth: 0.4,
    borderBottomColor: PALETTE.hair,
    marginTop: 8,
    marginBottom: 12,
  },
  docMetaCell: {
    fontFamily: "Inter",
    fontSize: 8,
    color: PALETTE.inkSoft,
    letterSpacing: 0.6,
    flex: 1,
  },
  docMetaKey: {
    color: PALETTE.inkMute,
    fontSize: 7.2,
    letterSpacing: 1,
    marginRight: 4,
    fontWeight: 600,
  },
  docMetaCenter: {
    fontFamily: "CormorantGaramond",
    fontSize: 12,
    fontWeight: 600,
    color: PALETTE.navy,
    letterSpacing: 4,
    textAlign: "center",
    flex: 1,
  },

  // ----- PARTY GRID (2-col bordered)
  partyGrid: {
    flexDirection: "row",
    borderWidth: 0.5,
    borderColor: PALETTE.hair,
    marginBottom: 10,
  },
  partyCell: {
    flex: 1,
    padding: 10,
    borderRightWidth: 0.5,
    borderRightColor: PALETTE.hair,
  },
  partyCellLast: { borderRightWidth: 0 },
  partyLabel: {
    fontFamily: "CormorantGaramond",
    fontSize: 9,
    fontWeight: 600,
    color: PALETTE.navy,
    letterSpacing: 3,
    paddingBottom: 3,
    marginBottom: 4,
    borderBottomWidth: 0.3,
    borderBottomColor: PALETTE.rule,
  },
  partyName: {
    fontFamily: "SourceSerif4",
    fontSize: 13,
    fontWeight: 600,
    color: PALETTE.ink,
    lineHeight: 1.2,
  },
  partySub: {
    fontFamily: "Inter",
    fontSize: 9,
    color: PALETTE.inkSoft,
    marginTop: 3,
  },
  partyIds: {
    marginTop: 5,
    fontFamily: "Inter",
    fontSize: 8,
  },
  partyIdRow: {
    flexDirection: "row",
    marginTop: 1,
  },
  partyIdKey: {
    color: PALETTE.inkMute,
    letterSpacing: 0.7,
    fontWeight: 600,
    fontSize: 7.5,
    width: 64,
  },
  partyIdValue: {
    color: PALETTE.ink,
    fontWeight: 600,
    flex: 1,
  },

  // ----- SECTION HEADING (Cormorant caps + warm-rule under)
  sectionHeading: {
    fontFamily: "CormorantGaramond",
    fontSize: 11,
    fontWeight: 600,
    color: PALETTE.navy,
    letterSpacing: 3,
    paddingBottom: 3,
    marginBottom: 6,
    borderBottomWidth: 0.3,
    borderBottomColor: PALETTE.rule,
  },

  // ----- VITALS (6-cell grid)
  vitalsRow: {
    flexDirection: "row",
    borderWidth: 0.5,
    borderColor: PALETTE.hair,
    backgroundColor: "#FFFCF4",
    marginBottom: 10,
  },
  vitalCell: {
    flex: 1,
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderRightWidth: 0.4,
    borderRightColor: PALETTE.hair,
    alignItems: "center",
  },
  vitalCellLast: { borderRightWidth: 0 },
  vitalLabel: {
    fontFamily: "Inter",
    fontSize: 7,
    fontWeight: 600,
    color: PALETTE.navySoft,
    letterSpacing: 1.2,
  },
  vitalValue: {
    fontFamily: "SourceSerif4",
    fontSize: 12,
    fontWeight: 600,
    color: PALETTE.ink,
    marginTop: 3,
  },
  vitalUnit: {
    fontFamily: "Inter",
    fontSize: 7.5,
    fontWeight: 500,
    color: PALETTE.inkSoft,
  },
  vitalEmpty: { color: PALETTE.inkMute, fontWeight: 500 },

  // ----- CLINICAL 2-UP (Chief Complaint / Provisional Diagnosis)
  clinicalRow: {
    flexDirection: "row",
    gap: 24,
    marginBottom: 10,
  },
  clinicalCol: { flex: 1 },
  clinicalBody: {
    fontFamily: "SourceSerif4",
    fontSize: 11,
    color: PALETTE.ink,
    lineHeight: 1.5,
  },
  clinicalEmpty: {
    fontFamily: "SourceSerif4",
    fontSize: 10,
    fontStyle: "italic",
    color: PALETTE.inkMute,
  },

  // ----- Rx HEADER
  rxHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginTop: 2,
    marginBottom: 4,
    gap: 8,
  },
  rxSymbol: {
    fontFamily: "CormorantGaramond",
    fontSize: 30,
    fontWeight: 700,
    fontStyle: "italic",
    color: PALETTE.navy,
    lineHeight: 1,
  },
  rxTitle: {
    fontFamily: "CormorantGaramond",
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: 3,
    color: PALETTE.navy,
    paddingBottom: 3,
  },

  // ----- MEDICATIONS TABLE
  medsTable: {
    borderTopWidth: 0.6,
    borderTopColor: PALETTE.navy,
    borderBottomWidth: 0.6,
    borderBottomColor: PALETTE.navy,
    marginBottom: 12,
  },
  medsHead: {
    flexDirection: "row",
    borderBottomWidth: 0.4,
    borderBottomColor: PALETTE.rule,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  medsHeadCell: {
    fontFamily: "Inter",
    fontSize: 7.5,
    fontWeight: 700,
    color: PALETTE.navy,
    letterSpacing: 1.5,
  },
  medsRow: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderTopWidth: 0.3,
    borderTopColor: PALETTE.hair,
    // react-pdf doesn't support border-style: dotted in this context;
    // a thin hairline reads similarly on inked paper.
  },
  medsRowFirst: { borderTopWidth: 0 },
  // column widths (sum: 100%)
  colNum: { width: "8%" },
  colDrug: { width: "37%", paddingRight: 6 },
  colDose: { width: "13%" },
  colFreq: { width: "13%" },
  colDur: { width: "14%" },
  colNotes: { width: "15%" },

  medsNumText: {
    fontFamily: "Inter",
    fontSize: 9,
    fontWeight: 600,
    color: PALETTE.inkMute,
  },
  drugName: {
    fontFamily: "SourceSerif4",
    fontSize: 10.5,
    fontWeight: 600,
    color: PALETTE.ink,
  },
  drugComposition: {
    fontFamily: "Inter",
    fontSize: 8.5,
    fontStyle: "italic",
    color: PALETTE.inkSoft,
    marginTop: 1.5,
  },
  medsCellText: {
    fontFamily: "Inter",
    fontSize: 9.5,
    color: PALETTE.ink,
  },
  medsNotesText: {
    fontFamily: "Inter",
    fontSize: 9,
    fontStyle: "italic",
    color: PALETTE.inkSoft,
  },
  medsEmpty: {
    fontFamily: "SourceSerif4",
    fontSize: 10,
    fontStyle: "italic",
    color: PALETTE.inkMute,
    padding: 10,
    textAlign: "center",
  },
  dash: { color: PALETTE.inkMute },

  // ----- INVESTIGATIONS + ADVICE (2-up)
  grid2: {
    flexDirection: "row",
    gap: 24,
    marginBottom: 12,
  },
  grid2Col: { flex: 1 },

  listRow: {
    flexDirection: "row",
    paddingVertical: 4,
    borderTopWidth: 0.3,
    borderTopColor: PALETTE.hair,
  },
  listRowFirst: { borderTopWidth: 0, paddingTop: 2 },
  listBullet: {
    fontFamily: "CormorantGaramond",
    fontSize: 8,
    color: PALETTE.navy,
    width: 14,
  },
  listText: {
    fontFamily: "SourceSerif4",
    fontSize: 10,
    color: PALETTE.ink,
    flex: 1,
  },
  listSub: {
    fontFamily: "Inter",
    fontSize: 8.5,
    fontStyle: "italic",
    color: PALETTE.inkSoft,
    marginTop: 1,
  },
  emptyBlock: {
    fontFamily: "SourceSerif4",
    fontSize: 10,
    fontStyle: "italic",
    color: PALETTE.inkMute,
    paddingVertical: 2,
  },

  // ----- SIGNATURE ROW
  signatureRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginTop: 16,
    paddingTop: 10,
    borderTopWidth: 0.3,
    borderTopColor: PALETTE.rule,
    gap: 24,
  },
  authNote: {
    flex: 1,
    fontFamily: "SourceSerif4",
    fontSize: 9,
    fontStyle: "italic",
    color: PALETTE.inkSoft,
    lineHeight: 1.55,
  },
  authNoteStrong: {
    color: PALETTE.navy,
    fontWeight: 600,
    fontStyle: "normal",
  },
  sigBlock: {
    alignItems: "flex-end",
  },
  stampAndSig: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  stampPlaceholder: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 0.8,
    borderStyle: "dashed",
    borderColor: PALETTE.navy,
    backgroundColor: "rgba(10, 38, 112, 0.025)",
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
  },
  stampSeal: {
    fontFamily: "CormorantGaramond",
    fontSize: 7.5,
    fontWeight: 600,
    color: PALETTE.navy,
    letterSpacing: 1,
    textAlign: "center",
  },
  stampSealSub: {
    fontFamily: "CormorantGaramond",
    fontSize: 6,
    color: PALETTE.navy,
    letterSpacing: 1.4,
    marginTop: 2,
    textAlign: "center",
  },
  stampAwaiting: {
    fontFamily: "Inter",
    fontSize: 5.5,
    fontWeight: 500,
    color: PALETTE.navy,
    letterSpacing: 0.4,
    marginTop: 3,
    textAlign: "center",
  },
  stampImage: { width: 70, height: 70, objectFit: "contain" },
  sigImage: { width: 140, height: 50, objectFit: "contain" },
  sigPlaceholder: {
    width: 140,
    height: 40,
    borderBottomWidth: 0.75,
    borderBottomColor: PALETTE.ink,
  },
  signedByLabel: {
    fontFamily: "Inter",
    fontSize: 7,
    color: PALETTE.inkMute,
    letterSpacing: 1.2,
    marginTop: 6,
    textAlign: "right",
  },
  signedByName: {
    fontFamily: "SourceSerif4",
    fontSize: 12,
    fontWeight: 600,
    color: PALETTE.ink,
    textAlign: "right",
  },
  signedByReg: {
    fontFamily: "Inter",
    fontSize: 8.5,
    color: PALETTE.inkSoft,
    marginTop: 2,
    textAlign: "right",
  },

  // ----- FOOTER (corp left, QR right)
  footer: {
    flexDirection: "row",
    marginTop: 16,
    paddingTop: 10,
    borderTopWidth: 1.5,
    borderTopColor: PALETTE.navy,
    gap: 24,
    alignItems: "flex-start",
  },
  corp: { flex: 1 },
  corpName: {
    fontFamily: "CormorantGaramond",
    fontSize: 10,
    fontWeight: 700,
    color: PALETTE.navy,
    letterSpacing: 2,
    marginBottom: 4,
  },
  corpLine: {
    fontFamily: "Inter",
    fontSize: 7.8,
    color: PALETTE.inkSoft,
    lineHeight: 1.55,
  },
  corpKey: {
    color: PALETTE.inkMute,
    fontSize: 7.2,
    letterSpacing: 0.8,
    fontWeight: 600,
  },
  corpSocials: {
    marginTop: 4,
    fontFamily: "SourceSerif4",
    fontSize: 7.5,
    color: PALETTE.inkSoft,
  },
  corpSocialLabel: {
    fontFamily: "Inter",
    color: PALETTE.inkMute,
    letterSpacing: 0.8,
    fontSize: 7,
    fontWeight: 600,
    marginRight: 4,
  },

  qrCell: { alignItems: "center", width: 80 },
  qrFrame: {
    width: 62,
    height: 62,
    backgroundColor: "#FFFFFF",
    borderWidth: 0.5,
    borderColor: PALETTE.navy,
    padding: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  qrImage: { width: 58, height: 58 },
  qrCaption: {
    fontFamily: "Inter",
    fontSize: 6.8,
    color: PALETTE.inkSoft,
    letterSpacing: 0.4,
    fontWeight: 600,
    marginTop: 4,
    textAlign: "center",
  },

  // ----- CONTROL STRIP (Document ID / Page X of Y / Issued)
  controlStrip: {
    flexDirection: "row",
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 0.3,
    borderTopColor: PALETTE.hair,
  },
  controlText: {
    flex: 1,
    fontFamily: "Inter",
    fontSize: 6.8,
    color: PALETTE.inkMute,
    letterSpacing: 0.6,
  },
  controlCenter: { textAlign: "center" },
  controlRight: { textAlign: "right" },

  // ----- COMPLIANCE (NMC footnote)
  compliance: {
    marginTop: 8,
    paddingTop: 7,
    borderTopWidth: 0.3,
    borderTopColor: PALETTE.hair,
    fontFamily: "SourceSerif4",
    fontSize: 7.8,
    fontStyle: "italic",
    color: PALETTE.inkMute,
    lineHeight: 1.55,
  },
  complianceStrong: {
    color: PALETTE.inkSoft,
    fontStyle: "normal",
  },
});

// -------- helpers ------------------------------------------------------

function fmtPatientLine(d: PrescriptionPdfData): string {
  const parts: string[] = [];
  if (d.patient_age != null) parts.push(`Age ${d.patient_age}`);
  if (d.patient_sex) {
    const sexLabel = { M: "Male", F: "Female", O: "Other", U: "Unspecified" }[
      d.patient_sex
    ];
    parts.push(sexLabel);
  }
  if (d.patient_weight_kg != null) parts.push(`${d.patient_weight_kg} kg`);
  return parts.join(" · "); // middot
}

function fmtSentDate(iso: string | null): string {
  if (!iso) return "DRAFT — not yet sent";
  const d = new Date(iso);
  // dd MMM yyyy, HH:mm IST — matches mockup "26 May 2026, 14:32 IST".
  const date = d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${date}, ${time} IST`;
}

function fmtDocumentId(prescription_code: string, version: number): string {
  return version > 1 ? `${prescription_code} · v${version}` : prescription_code;
}

function fmtBp(sys: number | null, dia: number | null): string | null {
  if (sys == null && dia == null) return null;
  return `${sys ?? "—"}/${dia ?? "—"}`;
}

function splitToBullets(s: string | null): string[] {
  if (!s) return [];
  return s
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function fmtDoctorReg(d: PrescriptionPdfData): string | null {
  if (!d.doctor_registration_no) return null;
  if (d.doctor_issuing_council) {
    return `Reg. ${d.doctor_registration_no} · ${d.doctor_issuing_council}`;
  }
  return `Reg. ${d.doctor_registration_no}`;
}

// -------- watermark (Sanocare logo as inline SVG) ---------------------
// Two kidney-shaped paths from public/logo.svg, rendered at 4.5% opacity
// behind page content. Inlined here so the PDF stays self-contained and
// the renderer doesn't need to fetch the SVG at render time.
function SanocareLogoMark() {
  return (
    <Svg viewBox="58 72 145 142" width={340} height={340}>
      <Path
        d="M64.25,131.47 C69.26,122.87 76.58,119.23 86.02,119.36 C89.85,119.41 93.7,119.44 97.49,119.04 C104.14,118.34 106.98,115.39 107.38,108.77 C107.69,103.79 107.35,98.78 107.69,93.81 C108.46,82.62 117.47,74.32 128.85,74.03 C140.55,73.74 150.61,82.09 152.05,93.12 C154.07,108.58 148.75,121.64 138.81,133.01 C127.51,145.95 114.34,156.54 98,162.48 C88.57,165.91 79.07,166.61 70.45,160.03 C61.71,153.37 59.56,143.53 64.25,131.47 Z"
        fill={PALETTE.blue}
      />
      <Path
        d="M147.6,202.53 C139.98,210.25 131.37,211.96 121.75,208.02 C112.36,204.18 108.35,196.78 107.9,186.86 C107.4,175.99 111.11,167.01 118.87,159.53 C129.04,149.71 139.15,139.81 149.32,129.98 C158.27,121.32 168.72,117.28 181.21,119.99 C192.18,122.37 199.57,132.16 198.97,143.34 C198.38,154.29 190.32,163.07 179.25,164.3 C174.3,164.85 169.27,164.55 164.29,164.78 C156.82,165.14 153.76,167.93 153.02,175.37 C152.52,180.34 152.94,185.43 152.06,190.31 C151.32,194.42 149.3,198.29 147.6,202.53 Z"
        fill={PALETTE.blue}
      />
    </Svg>
  );
}

// -------- the document ------------------------------------------------

export function PrescriptionPdf({
  data,
  signatureMode,
  signatureDataUrl,
  stampMode,
  stampDataUrl,
}: PrescriptionPdfProps) {
  const isDraft = data.sent_at_iso == null;
  const patientLine = fmtPatientLine(data);
  const items = data.items.slice().sort((a, b) => a.ordinal - b.ordinal);
  const labTests = data.lab_tests
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal);
  const adviceLines = splitToBullets(data.general_advice);
  const followUpLines = splitToBullets(data.follow_up_advice);
  const bpDisplay = fmtBp(data.bp_sys, data.bp_dia);

  return (
    <Document
      title={`Prescription ${data.prescription_code}`}
      author={data.doctor_full_name}
      creator="Sanocare"
      producer="Sanocare"
    >
      <Page size="A4" style={styles.page} wrap>
        {/* Inset double-rule frame (drawn on every page) */}
        <View style={styles.frameOuter} fixed />
        <View style={styles.frameInner} fixed />

        {/* Watermark (4.5% opacity Sanocare mark, centered) */}
        <View style={styles.watermarkWrap} fixed>
          <SanocareLogoMark />
        </View>

        {/* DRAFT stamp (only on previews) */}
        {isDraft && <Text style={styles.draftStamp}>DRAFT</Text>}

        {/* ============================ Letterhead ======================= */}
        <View style={styles.letterhead}>
          <Text style={styles.clinicName}>SANOCARE</Text>
          <Text style={styles.clinicSubtitle}>
            Doctor Consultation · Telemedicine
          </Text>
          <Text style={styles.identityStrip}>
            sanocare.in  <Text style={styles.identityDivider}>·</Text>  Hospital-grade
            clinical care, delivered online
          </Text>
          <View style={styles.ornamentRow}>
            <View style={styles.ornamentLine} />
            <View style={styles.ornamentDot} />
            <View style={styles.ornamentDiamond} />
            <View style={styles.ornamentDot} />
            <View style={styles.ornamentLine} />
          </View>
        </View>

        {/* ============================ Doc meta ========================= */}
        <View style={styles.docMeta}>
          <Text style={styles.docMetaCell}>
            <Text style={styles.docMetaKey}>ISSUED</Text>
            {fmtSentDate(data.sent_at_iso)}
          </Text>
          <Text style={styles.docMetaCenter}>PRESCRIPTION</Text>
          <Text style={[styles.docMetaCell, { textAlign: "right" }]}>
            <Text style={styles.docMetaKey}>NO.</Text>
            {fmtDocumentId(data.prescription_code, data.version)}
          </Text>
        </View>

        {/* ============================ Party grid ======================= */}
        <View style={styles.partyGrid}>
          {/* Patient */}
          <View style={styles.partyCell}>
            <Text style={styles.partyLabel}>PATIENT</Text>
            <Text style={styles.partyName}>{data.patient_name}</Text>
            {patientLine ? <Text style={styles.partySub}>{patientLine}</Text> : null}
            {(data.patient_code || data.booking_code) && (
              <View style={styles.partyIds}>
                {data.patient_code ? (
                  <View style={styles.partyIdRow}>
                    <Text style={styles.partyIdKey}>PATIENT ID</Text>
                    <Text style={styles.partyIdValue}>{data.patient_code}</Text>
                  </View>
                ) : null}
                {data.booking_code ? (
                  <View style={styles.partyIdRow}>
                    <Text style={styles.partyIdKey}>BOOKING ID</Text>
                    <Text style={styles.partyIdValue}>{data.booking_code}</Text>
                  </View>
                ) : null}
              </View>
            )}
          </View>

          {/* Attending physician */}
          <View style={[styles.partyCell, styles.partyCellLast]}>
            <Text style={styles.partyLabel}>ATTENDING PHYSICIAN</Text>
            <Text style={styles.partyName}>
              {data.doctor_full_name}
              {data.doctor_qualification ? `, ${data.doctor_qualification}` : ""}
            </Text>
            <Text style={styles.partySub}>Sanocare Telemedicine</Text>
            <View style={styles.partyIds}>
              {fmtDoctorReg(data) ? (
                <View style={styles.partyIdRow}>
                  <Text style={styles.partyIdKey}>REG. NO.</Text>
                  <Text style={styles.partyIdValue}>
                    {data.doctor_registration_no}
                    {data.doctor_issuing_council
                      ? ` · ${data.doctor_issuing_council}`
                      : ""}
                  </Text>
                </View>
              ) : null}
              {data.consult_mode ? (
                <View style={styles.partyIdRow}>
                  <Text style={styles.partyIdKey}>CONSULT MODE</Text>
                  <Text style={styles.partyIdValue}>{data.consult_mode}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* ============================ Vitals =========================== */}
        <Text style={styles.sectionHeading}>VITALS</Text>
        <View style={styles.vitalsRow}>
          <VitalCell label="BP" value={bpDisplay} />
          <VitalCell label="PULSE" value={data.pulse_bpm} unit="bpm" />
          <VitalCell label="SpO₂" value={data.spo2_pct} unit="%" />
          <VitalCell label="TEMP" value={data.temp_c} unit="°C" />
          <VitalCell label="WEIGHT" value={data.patient_weight_kg} unit="kg" />
          <VitalCell label="HEIGHT" value={data.height_cm} unit="cm" last />
        </View>

        {/* ============================ Clinical row ===================== */}
        <View style={styles.clinicalRow}>
          <View style={styles.clinicalCol}>
            <Text style={styles.sectionHeading}>CHIEF COMPLAINT</Text>
            {data.chief_complaint ? (
              <Text style={styles.clinicalBody}>{data.chief_complaint}</Text>
            ) : (
              <Text style={styles.clinicalEmpty}>—</Text>
            )}
          </View>
          <View style={styles.clinicalCol}>
            <Text style={styles.sectionHeading}>PROVISIONAL DIAGNOSIS</Text>
            {data.provisional_diagnosis ? (
              <Text style={styles.clinicalBody}>{data.provisional_diagnosis}</Text>
            ) : (
              <Text style={styles.clinicalEmpty}>—</Text>
            )}
          </View>
        </View>

        {/* ============================ Rx header + table ================ */}
        <View style={styles.rxHeader}>
          <Text style={styles.rxSymbol}>℞</Text>
          <Text style={styles.rxTitle}>MEDICATIONS</Text>
        </View>

        <View style={styles.medsTable}>
          <View style={styles.medsHead} fixed>
            <Text style={[styles.medsHeadCell, styles.colNum]}>#</Text>
            <Text style={[styles.medsHeadCell, styles.colDrug]}>DRUG</Text>
            <Text style={[styles.medsHeadCell, styles.colDose]}>DOSE</Text>
            <Text style={[styles.medsHeadCell, styles.colFreq]}>FREQUENCY</Text>
            <Text style={[styles.medsHeadCell, styles.colDur]}>DURATION</Text>
            <Text style={[styles.medsHeadCell, styles.colNotes]}>NOTES</Text>
          </View>

          {items.length === 0 ? (
            <Text style={styles.medsEmpty}>(no medications)</Text>
          ) : (
            items.map((it, idx) => (
              <View
                key={it.ordinal}
                style={[
                  styles.medsRow,
                  idx === 0 ? styles.medsRowFirst : {},
                ]}
                wrap={false}
              >
                <Text style={[styles.medsNumText, styles.colNum]}>
                  {it.ordinal}
                </Text>
                <View style={styles.colDrug}>
                  <Text style={styles.drugName}>{it.drug_name}</Text>
                  {it.composition ? (
                    <Text style={styles.drugComposition}>{it.composition}</Text>
                  ) : null}
                </View>
                <Text style={[styles.medsCellText, styles.colDose]}>
                  {it.dose ?? <Text style={styles.dash}>—</Text>}
                </Text>
                <Text style={[styles.medsCellText, styles.colFreq]}>
                  {it.frequency ?? <Text style={styles.dash}>—</Text>}
                </Text>
                <Text style={[styles.medsCellText, styles.colDur]}>
                  {it.duration ?? <Text style={styles.dash}>—</Text>}
                </Text>
                <Text style={[styles.medsNotesText, styles.colNotes]}>
                  {it.instructions ?? <Text style={styles.dash}>—</Text>}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* ============================ Investigations + Advice ========== */}
        <View style={styles.grid2}>
          <View style={styles.grid2Col}>
            <Text style={styles.sectionHeading}>INVESTIGATIONS ADVISED</Text>
            {labTests.length === 0 ? (
              <Text style={styles.emptyBlock}>None advised</Text>
            ) : (
              labTests.map((t, idx) => (
                <View
                  key={t.ordinal}
                  style={[styles.listRow, idx === 0 ? styles.listRowFirst : {}]}
                  wrap={false}
                >
                  <Text style={styles.listBullet}>❖</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listText}>{t.test_name}</Text>
                    {t.instructions ? (
                      <Text style={styles.listSub}>{t.instructions}</Text>
                    ) : null}
                  </View>
                </View>
              ))
            )}
          </View>

          <View style={styles.grid2Col}>
            <Text style={styles.sectionHeading}>ADVICE &amp; FOLLOW-UP</Text>
            {adviceLines.length === 0 && followUpLines.length === 0 ? (
              <Text style={styles.emptyBlock}>—</Text>
            ) : (
              <>
                {adviceLines.map((line, idx) => (
                  <View
                    key={`a-${idx}`}
                    style={[
                      styles.listRow,
                      idx === 0 ? styles.listRowFirst : {},
                    ]}
                    wrap={false}
                  >
                    <Text style={styles.listBullet}>❖</Text>
                    <Text style={styles.listText}>{line}</Text>
                  </View>
                ))}
                {followUpLines.map((line, idx) => (
                  <View
                    key={`f-${idx}`}
                    style={[
                      styles.listRow,
                      adviceLines.length === 0 && idx === 0
                        ? styles.listRowFirst
                        : {},
                    ]}
                    wrap={false}
                  >
                    <Text style={styles.listBullet}>❖</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.listText}>{line}</Text>
                      {idx === 0 && adviceLines.length > 0 ? (
                        <Text style={styles.listSub}>Follow-up</Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </>
            )}
          </View>
        </View>

        {/* ============================ Signature row ==================== */}
        <View style={styles.signatureRow} wrap={false}>
          <Text style={styles.authNote}>
            <Text style={styles.authNoteStrong}>
              Digitally signed and issued via Sanocare
            </Text>
            {" "}— this prescription is authenticated by Sanocare&apos;s clinical-records system at the timestamp shown above. Verify online at{" "}
            <Text style={styles.authNoteStrong}>sanocare.in/rx</Text>
            {" "}using the prescription number.
          </Text>

          <View style={styles.sigBlock}>
            <View style={styles.stampAndSig}>
              {stampMode === "embedded" && stampDataUrl ? (
                // eslint-disable-next-line jsx-a11y/alt-text
                <Image src={stampDataUrl} style={styles.stampImage} />
              ) : (
                <View style={styles.stampPlaceholder}>
                  <Text style={styles.stampSeal}>SANOCARE</Text>
                  <Text style={styles.stampSealSub}>CLINIC SEAL</Text>
                  <Text style={styles.stampAwaiting}>awaiting upload</Text>
                </View>
              )}

              {signatureMode === "embedded" && signatureDataUrl ? (
                // eslint-disable-next-line jsx-a11y/alt-text
                <Image src={signatureDataUrl} style={styles.sigImage} />
              ) : (
                <View style={styles.sigPlaceholder} />
              )}
            </View>
            <Text style={styles.signedByLabel}>SIGNED BY</Text>
            <Text style={styles.signedByName}>
              {data.doctor_full_name}
              {data.doctor_qualification ? `, ${data.doctor_qualification}` : ""}
            </Text>
            {fmtDoctorReg(data) ? (
              <Text style={styles.signedByReg}>{fmtDoctorReg(data)}</Text>
            ) : null}
          </View>
        </View>

        {/* ============================ Footer (corp + QR) =============== */}
        <View style={styles.footer} wrap={false}>
          <View style={styles.corp}>
            <Text style={styles.corpName}>
              SANOCARE TECH INNOVATIONS PVT. LTD.
            </Text>
            <Text style={styles.corpLine}>
              Online doctor consultations · Health records · Telemedicine
            </Text>
            <Text style={[styles.corpLine, { marginTop: 4 }]}>
              <Text style={styles.corpKey}>WEB </Text>sanocare.in
              <Text style={styles.corpKey}>   ·   EMAIL </Text>care@sanocare.in
            </Text>
            <Text style={styles.corpSocials}>
              <Text style={styles.corpSocialLabel}>SOCIAL</Text>
              @sanocare.in  ·  sanocare.in
            </Text>
          </View>

          <View style={styles.qrCell}>
            <View style={styles.qrFrame}>
              {data.qr_data_url ? (
                // eslint-disable-next-line jsx-a11y/alt-text
                <Image src={data.qr_data_url} style={styles.qrImage} />
              ) : null}
            </View>
            <Text style={styles.qrCaption}>VERIFY AT{"\n"}SANOCARE.IN</Text>
          </View>
        </View>

        {/* ============================ Control strip ==================== */}
        <View style={styles.controlStrip} fixed>
          <Text style={styles.controlText}>
            DOC {fmtDocumentId(data.prescription_code, data.version)}
          </Text>
          <Text
            style={[styles.controlText, styles.controlCenter]}
            render={({ pageNumber, totalPages }) =>
              `PAGE ${pageNumber} OF ${totalPages}`
            }
          />
          <Text style={[styles.controlText, styles.controlRight]}>
            ISSUED {fmtSentDate(data.sent_at_iso)}
          </Text>
        </View>

        {/* ============================ Compliance ======================= */}
        <Text style={styles.compliance}>
          This is a digitally generated and authenticated prescription issued
          under the{" "}
          <Text style={styles.complianceStrong}>
            Telemedicine Practice Guidelines, 2020
          </Text>
          {" "}(MoHFW / NMC, India). The information in this prescription is the
          opinion of the registered medical practitioner identified above, based
          on the clinical encounter conducted via{" "}
          {data.consult_mode ?? "video consultation"}. Dispensing pharmacists
          may verify the authenticity of this script using the prescription
          number and patient identifier at sanocare.in.
        </Text>
      </Page>
    </Document>
  );
}

// -------- VitalCell sub-component --------------------------------------
// Kept local to this file — only renders inside the vitals row.

function VitalCell({
  label,
  value,
  unit,
  last = false,
}: {
  label: string;
  value: number | string | null;
  unit?: string;
  last?: boolean;
}) {
  const isEmpty = value == null || value === "";
  return (
    <View
      style={[styles.vitalCell, last ? styles.vitalCellLast : {}]}
    >
      <Text style={styles.vitalLabel}>{label}</Text>
      {isEmpty ? (
        <Text style={[styles.vitalValue, styles.vitalEmpty]}>—</Text>
      ) : (
        <Text style={styles.vitalValue}>
          {value}
          {unit ? <Text style={styles.vitalUnit}> {unit}</Text> : null}
        </Text>
      )}
    </View>
  );
}
