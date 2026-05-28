// React-PDF document for a single Rx version (v5 clean tabular).
//
// The same component drives:
//   - the server-side final render (renderPrescriptionPdf.ts ->
//     @react-pdf/renderer renderToBuffer), invoked from
//     sendPrescription() in the doctor server actions, with
//     signatureMode='embedded' and signatureDataUrl set
//   - the doctor-side preview during composition, with
//     signatureMode='placeholder'
//
// v5 design language (locked per founder's "Mrs Sonia Gupta" reference):
//   - Inter only (sans-serif). No italics anywhere.
//   - White paper, no cream, no watermark, no inset frame.
//   - Single 0.6pt black border wraps content; section dividers 0.6pt
//     black; internal grid hair-rules 0.4-0.5pt at #94A3B8.
//   - Brand blue (#2B81FF) used for the SANOCARE wordmark in the
//     header band, the corporate name in the footer band, and the
//     butterfly icon (3 occurrences: header left + 2 footer slots).
//   - Coral (#DC6A40) used only on the "FOR APPOINTMENT" WhatsApp
//     line in the footer.
//   - Header service-type LOCKED to "Medical Prescription" — does not
//     vary with modality. (Founder's v5 brief, §3 "Header service-type
//     — LOCKED".)
//
// Section order (top → bottom):
//   header band → patient info table → Presenting Complaints →
//   Vitals (label cell + 6 vital cells) → Diagnosis → Past Medical
//   History → Medication table → Investigation list →
//   Dietary & Lifestyle Advice (two-col with signature block right) →
//   footer band (icon | corp + CIN | icon)
//
// The footer band uses marginTop:"auto" so it anchors to the bottom
// of the content area on single-page Rx (the common case). On a
// multi-page Rx it flows naturally after the last section. v5 is
// expected to be single-page by default.

import { Document, Page, Text, View, StyleSheet, Image, Svg, Path } from "@react-pdf/renderer";

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
  /** e.g. "U.P. Medical Council" — printed alongside reg. no. on the
   *  signature line. */
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

  // v5 new: booking metadata for the patient-info table.
  /** bookings.booked_through — channel string (Website / WhatsApp /
   *  Walk-in / Phone). sendPrescription defaults this to "Website"
   *  when the booking row column is null. */
  booked_through: string | null;
  /** bookings.sponsor_label — display string for the sponsor cell.
   *  sendPrescription derives this from payment_status when null
   *  (CAPTURED with amount → "Self Pay ₹X", 0-amount → "Test",
   *  else "Self Pay"). */
  sponsor_label: string | null;

  // Vitals (all nullable; rendered as em-dash when null)
  bp_sys: number | null;
  bp_dia: number | null;
  pulse_bpm: number | null;
  spo2_pct: number | null;
  temp_c: number | null;
  height_cm: number | null;

  // Clinical body
  chief_complaint: string | null;
  /** v5 new: free-text duration shown under Presenting Complaints
   *  (e.g. "X 2 days"). */
  presenting_complaints_duration: string | null;
  provisional_diagnosis: string | null;
  /** v5 new: free-text past medical history block. */
  past_medical_history: string | null;
  items: PrescriptionItemForPdf[];
  lab_tests: PrescriptionLabTestForPdf[];
  general_advice: string | null;
  follow_up_advice: string | null;
};

export type PrescriptionPdfProps = {
  data: PrescriptionPdfData;
  /**
   * 'placeholder' renders a dashed-bordered slot with "[ signature
   *  image ]" caption (composer preview path — the signed asset is
   *  sensitive and we don't want to expose it pre-send).
   *  'embedded' renders signatureDataUrl as an <Image>. The send-time
   *  server render uses this with the doctor's signature_image_url
   *  resolved to a base64 data URL.
   */
  signatureMode: "placeholder" | "embedded";
  /**
   * Required when signatureMode='embedded'. Either a data: URL
   * (base64-encoded PNG/JPG, what renderPrescriptionPdf.ts produces)
   * or a public HTTP URL. Ignored when signatureMode='placeholder'.
   */
  signatureDataUrl?: string | null;
};

// -------- palette -----------------------------------------------------

const PALETTE = {
  ink:      "#0F172A",
  inkSoft:  "#334155",
  inkMute:  "#64748B",
  border:   "#1F2937",   // near-black box borders
  hair:     "#94A3B8",   // lighter inner rules
  brand:    "#2B81FF",   // SANOCARE wordmark, footer corp, butterfly
  coral:    "#DC6A40",   // WhatsApp number in footer (only)
  paper:    "#FFFFFF",   // pure white background
  headerBg: "#F1F5F9",   // medication table header band
} as const;

// -------- styling ------------------------------------------------------
// pt-units throughout. 1mm ≈ 2.83465pt.
// Common conversions: 12mm=34pt, 5mm=14pt, 3mm=8.5pt, 2mm=5.7pt,
// 1.6mm=4.5pt, 18mm=51pt, 16mm=45pt, 36mm=102pt, 38mm=108pt,
// 60mm=170pt, 20mm=57pt.

const styles = StyleSheet.create({
  page: {
    fontFamily: "Inter",
    fontSize: 10,
    color: PALETTE.ink,
    backgroundColor: PALETTE.paper,
    padding: 34, // 12mm all sides
    lineHeight: 1.4,
  },
  docBorder: {
    flex: 1,
    flexDirection: "column",
    borderWidth: 0.6,
    borderColor: PALETTE.border,
  },

  // ----- HEADER BAND -----
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11, // ~4mm
    paddingHorizontal: 14, // 5mm
    borderBottomWidth: 0.6,
    borderBottomColor: PALETTE.border,
  },
  headerLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5.7, // 2mm
  },
  headerBrand: {
    fontSize: 15.5,
    fontWeight: 700,
    color: PALETTE.brand,
    letterSpacing: 0.5,
  },
  headerCenter: {
    flex: 1,
    textAlign: "center",
  },
  headerTitle: {
    fontSize: 17.5,
    fontWeight: 700,
    color: PALETTE.ink,
    letterSpacing: 0.5,
    textAlign: "center",
  },
  headerRight: {
    flex: 1,
    flexDirection: "column",
    alignItems: "flex-end",
  },
  headerRxLabel: {
    fontSize: 8,
    color: PALETTE.inkMute,
    fontWeight: 600,
    letterSpacing: 1.4,
  },
  headerRxCode: {
    fontSize: 12.5,
    color: PALETTE.ink,
    fontWeight: 700,
    marginTop: 1.5,
  },

  // ----- PATIENT META TABLE -----
  metaTable: {
    flexDirection: "column",
    borderBottomWidth: 0.6,
    borderBottomColor: PALETTE.border,
  },
  metaRow: {
    flexDirection: "row",
  },
  metaCell: {
    flex: 1,
    flexDirection: "row",
    paddingVertical: 4.5, // 1.6mm
    paddingHorizontal: 14, // 5mm
    alignItems: "baseline",
  },
  metaCellLeft: {
    borderRightWidth: 0.6,
    borderRightColor: PALETTE.border,
  },
  metaLabel: {
    width: 108, // 38mm
    fontWeight: 600,
    color: PALETTE.ink,
  },
  metaValue: {
    flex: 1,
    fontWeight: 400,
    color: PALETTE.ink,
  },

  // ----- SECTION -----
  section: {
    paddingVertical: 8.5, // 3mm
    paddingHorizontal: 14, // 5mm
    borderBottomWidth: 0.6,
    borderBottomColor: PALETTE.border,
  },
  sectionHeading: {
    fontWeight: 700,
    color: PALETTE.ink,
    fontSize: 10.5,
    marginBottom: 4.3, // 1.5mm
  },
  sectionBody: {
    color: PALETTE.ink,
    lineHeight: 1.5,
  },

  // ----- VITALS GRID -----
  vitalsSection: {
    borderBottomWidth: 0.6,
    borderBottomColor: PALETTE.border,
  },
  vitalsHeaderRow: {
    flexDirection: "row",
  },
  vitalsValueRow: {
    flexDirection: "row",
    borderTopWidth: 0.4,
    borderTopColor: PALETTE.hair,
  },
  vCellLeft: {
    width: 102, // 36mm
    paddingVertical: 5.7, // 2mm
    paddingHorizontal: 14, // 5mm
    borderRightWidth: 0.6,
    borderRightColor: PALETTE.border,
    flexDirection: "column",
  },
  vCell: {
    flex: 1,
    paddingVertical: 5.7,
    paddingHorizontal: 8.5,
    borderRightWidth: 0.5,
    borderRightColor: PALETTE.hair,
    alignItems: "center",
  },
  vCellLast: {
    borderRightWidth: 0,
  },
  vitalsHeadLabel: {
    fontWeight: 700,
    fontSize: 9.5,
    color: PALETTE.ink,
  },
  vitalsHeadDate: {
    fontWeight: 400,
    fontSize: 9,
    color: PALETTE.inkMute,
    marginTop: 1.4,
  },
  vitalName: {
    fontWeight: 600,
    fontSize: 8.5,
    color: PALETTE.inkSoft,
    letterSpacing: 0.4,
  },
  vitalValue: {
    fontSize: 10,
    color: PALETTE.ink,
    marginTop: 2.3,
  },
  vitalEmpty: {
    color: PALETTE.inkMute,
  },

  // ----- DIAGNOSIS STRONG PREFIX -----
  diagnosisStrong: {
    fontWeight: 700,
    color: PALETTE.ink,
  },

  // ----- MEDICATION TABLE -----
  medsTable: {
    marginTop: 4.3,
    flexDirection: "column",
  },
  medsHead: {
    flexDirection: "row",
    backgroundColor: PALETTE.headerBg,
  },
  medsHeadCell: {
    fontSize: 9,
    fontWeight: 700,
    color: PALETTE.inkSoft,
    letterSpacing: 0.3,
    paddingVertical: 4.3, // 1.5mm
    paddingHorizontal: 5.7, // 2mm
    borderWidth: 0.4,
    borderColor: PALETTE.hair,
  },
  medsRow: {
    flexDirection: "row",
  },
  medsCell: {
    fontSize: 9.5,
    color: PALETTE.ink,
    paddingVertical: 4.3,
    paddingHorizontal: 5.7,
    borderWidth: 0.4,
    borderColor: PALETTE.hair,
  },
  colNum: { width: 26 }, // 9mm
  colDrug: { flex: 1 },
  colDose: { width: 62 }, // 22mm
  colFreq: { width: 62 },
  colDur: { width: 68 }, // 24mm
  colNotes: { width: 108 }, // 38mm
  drugName: { fontWeight: 700, color: PALETTE.ink },
  drugComposition: { color: PALETTE.inkSoft, fontSize: 9, marginTop: 1 },
  cellDash: { color: PALETTE.inkMute, textAlign: "center" },
  medsEmpty: {
    color: PALETTE.inkMute,
    fontSize: 9.5,
    marginTop: 2.8, // 1mm
  },

  // ----- INVESTIGATION LIST -----
  listRow: {
    paddingVertical: 1.7, // 0.6mm
  },

  // ----- ADVICE ROW (advice list + signature block side-by-side) -----
  adviceRow: {
    flexDirection: "row",
    gap: 17, // 6mm
    alignItems: "flex-end",
  },
  adviceLeft: {
    flex: 1,
  },
  signatureBlock: {
    width: 170, // 60mm
    flexDirection: "column",
  },
  signatureImage: {
    height: 57, // 20mm
    maxWidth: 142, // 50mm
    objectFit: "contain",
    marginBottom: 2.8,
  },
  signaturePlaceholder: {
    height: 57,
    width: 142,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: PALETTE.hair,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2.8,
  },
  signaturePlaceholderText: {
    color: PALETTE.hair,
    fontSize: 8,
  },
  doctorName: {
    fontWeight: 700,
    color: PALETTE.ink,
    fontSize: 10,
  },
  doctorQual: {
    color: PALETTE.inkSoft,
    fontSize: 9.5,
  },
  doctorReg: {
    color: PALETTE.inkSoft,
    fontSize: 9.5,
  },

  // ----- FOOTER BAND -----
  footerBand: {
    marginTop: "auto", // anchor to bottom on single-page Rx
    flexDirection: "row",
    alignItems: "center",
    gap: 14, // 5mm
    paddingVertical: 10, // 3.5mm
    paddingHorizontal: 14, // 5mm
    borderWidth: 0.6,
    borderColor: PALETTE.border,
    borderRadius: 3, // 1mm
    margin: 14, // 5mm spacing from docBorder edges
  },
  footerCenter: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
  },
  footerCompany: {
    fontWeight: 700,
    color: PALETTE.brand,
    fontSize: 10,
    letterSpacing: 0.3,
    marginBottom: 2.8,
    textAlign: "center",
  },
  footerContact: {
    color: PALETTE.ink,
    fontSize: 9.5,
    textAlign: "center",
  },
  footerWhatsapp: {
    color: PALETTE.coral,
    fontWeight: 600,
    fontSize: 9.5,
    marginTop: 1.4,
    textAlign: "center",
  },
  footerCin: {
    color: PALETTE.ink,
    fontSize: 9.5,
    marginTop: 1.4,
    textAlign: "center",
  },
});

// -------- inline butterfly SVG ----------------------------------------
// Two kidney-shaped paths from public/logo.svg, scaled via the size
// prop. Used 3× per page: header (18mm) + footer left (16mm) + footer
// right (16mm). Inlined here so the PDF stays self-contained with no
// outbound asset fetch.

function SanocareIcon({ size }: { size: number }) {
  return (
    <Svg viewBox="58 72 145 142" width={size} height={size}>
      <Path
        d="M64.25,131.47 C69.26,122.87 76.58,119.23 86.02,119.36 C89.85,119.41 93.7,119.44 97.49,119.04 C104.14,118.34 106.98,115.39 107.38,108.77 C107.69,103.79 107.35,98.78 107.69,93.81 C108.46,82.62 117.47,74.32 128.85,74.03 C140.55,73.74 150.61,82.09 152.05,93.12 C154.07,108.58 148.75,121.64 138.81,133.01 C127.51,145.95 114.34,156.54 98,162.48 C88.57,165.91 79.07,166.61 70.45,160.03 C61.71,153.37 59.56,143.53 64.25,131.47 Z"
        fill={PALETTE.brand}
      />
      <Path
        d="M147.6,202.53 C139.98,210.25 131.37,211.96 121.75,208.02 C112.36,204.18 108.35,196.78 107.9,186.86 C107.4,175.99 111.11,167.01 118.87,159.53 C129.04,149.71 139.15,139.81 149.32,129.98 C158.27,121.32 168.72,117.28 181.21,119.99 C192.18,122.37 199.57,132.16 198.97,143.34 C198.38,154.29 190.32,163.07 179.25,164.3 C174.3,164.85 169.27,164.55 164.29,164.78 C156.82,165.14 153.76,167.93 153.02,175.37 C152.52,180.34 152.94,185.43 152.06,190.31 C151.32,194.42 149.3,198.29 147.6,202.53 Z"
        fill={PALETTE.brand}
      />
    </Svg>
  );
}

// -------- helpers ------------------------------------------------------

function fmtAgeSex(d: PrescriptionPdfData): string {
  const ageStr = d.patient_age == null ? "—" : String(d.patient_age);
  const sexStr = d.patient_sex == null ? "—" : d.patient_sex; // M / F / O / U
  return `${ageStr} / ${sexStr}`;
}

function fmtDoctorLine(d: PrescriptionPdfData): string {
  const drName = `Dr ${d.doctor_full_name}`;
  return d.doctor_qualification ? `${drName}, ${d.doctor_qualification}` : drName;
}

/**
 * Format "27/5/26, 17:06 HRs" — matches the founder's Sonia Gupta
 * reference. Day and month are non-zero-padded; year is 2-digit;
 * hour/minute are 2-digit 24h with the "HRs" suffix.
 */
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear() % 100;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year}, ${hh}:${mm} HRs`;
}

function fmtBp(sys: number | null, dia: number | null): string | null {
  if (sys == null && dia == null) return null;
  if (sys != null && dia != null) return `${sys}/${dia}`;
  return `${sys ?? "—"}/${dia ?? "—"}`;
}

function fmtDoctorReg(d: PrescriptionPdfData): string {
  if (!d.doctor_registration_no) return "";
  if (d.doctor_issuing_council) {
    return `Regn No.: ${d.doctor_registration_no} / ${d.doctor_issuing_council}`;
  }
  return `Regn No.: ${d.doctor_registration_no}`;
}

function splitToLines(s: string | null): string[] {
  if (!s) return [];
  return s
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

// -------- the document ------------------------------------------------

export function PrescriptionPdf({
  data,
  signatureMode,
  signatureDataUrl,
}: PrescriptionPdfProps) {
  const items = data.items.slice().sort((a, b) => a.ordinal - b.ordinal);
  const labTests = data.lab_tests.slice().sort((a, b) => a.ordinal - b.ordinal);

  // Combine general advice + follow-up into one bulleted list — matches
  // the mockup's "Dietary & Lifestyle Advice" section (single list).
  const adviceLines = [
    ...splitToLines(data.general_advice),
    ...splitToLines(data.follow_up_advice),
  ];

  const bp = fmtBp(data.bp_sys, data.bp_dia);
  const sentDateTime = fmtDateTime(data.sent_at_iso);

  // Booked Through fallback to "Website" if null (sendPrescription
  // applies the same default at snapshot time; this is belt + braces
  // for older drafts that pre-date M028).
  const bookedThrough = data.booked_through ?? "Website";

  // Sponsor label: prefer the snapshot column; fall back to a generic
  // "Self Pay" if null (sendPrescription does the payment_status
  // derivation upstream).
  const sponsorLabel = data.sponsor_label ?? "Self Pay";

  return (
    <Document
      title={`Prescription ${data.prescription_code}`}
      author={data.doctor_full_name}
      creator="Sanocare"
      producer="Sanocare"
    >
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.docBorder}>

          {/* ============================ Header band ====================== */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <SanocareIcon size={51} />
              <Text style={styles.headerBrand}>SANOCARE</Text>
            </View>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>Medical Prescription</Text>
            </View>
            <View style={styles.headerRight}>
              <Text style={styles.headerRxLabel}>RX NO.</Text>
              <Text style={styles.headerRxCode}>
                {data.prescription_code}
                {data.version > 1 ? `  ·  v${data.version}` : ""}
              </Text>
            </View>
          </View>

          {/* ============================ Patient info table =============== */}
          <View style={styles.metaTable}>
            {/* Row 1: Patient Name | Date & Time */}
            <View style={styles.metaRow}>
              <View style={[styles.metaCell, styles.metaCellLeft]}>
                <Text style={styles.metaLabel}>Patient Name:</Text>
                <Text style={styles.metaValue}>{data.patient_name}</Text>
              </View>
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>Date &amp; Time:</Text>
                <Text style={styles.metaValue}>{sentDateTime}</Text>
              </View>
            </View>
            {/* Row 2: Age / Gender | Booking ID */}
            <View style={styles.metaRow}>
              <View style={[styles.metaCell, styles.metaCellLeft]}>
                <Text style={styles.metaLabel}>Age / Gender:</Text>
                <Text style={styles.metaValue}>{fmtAgeSex(data)}</Text>
              </View>
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>Booking ID:</Text>
                <Text style={styles.metaValue}>{data.booking_code ?? "—"}</Text>
              </View>
            </View>
            {/* Row 3: Doctor | Booked Through */}
            <View style={styles.metaRow}>
              <View style={[styles.metaCell, styles.metaCellLeft]}>
                <Text style={styles.metaLabel}>Doctor:</Text>
                <Text style={styles.metaValue}>{fmtDoctorLine(data)}</Text>
              </View>
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>Booked Through:</Text>
                <Text style={styles.metaValue}>{bookedThrough}</Text>
              </View>
            </View>
            {/* Row 4: Patient ID | Sponsor */}
            <View style={styles.metaRow}>
              <View style={[styles.metaCell, styles.metaCellLeft]}>
                <Text style={styles.metaLabel}>Patient ID:</Text>
                <Text style={styles.metaValue}>{data.patient_code ?? "—"}</Text>
              </View>
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>Sponsor:</Text>
                <Text style={styles.metaValue}>{sponsorLabel}</Text>
              </View>
            </View>
          </View>

          {/* ============================ Presenting Complaints ============ */}
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Presenting Complaints</Text>
            <View style={styles.sectionBody}>
              <Text>{data.chief_complaint ?? "—"}</Text>
              {data.presenting_complaints_duration ? (
                <Text>{data.presenting_complaints_duration}</Text>
              ) : null}
            </View>
          </View>

          {/* ============================ Vitals =========================== */}
          <View style={styles.vitalsSection}>
            {/* Row 1: heading + vital names */}
            <View style={styles.vitalsHeaderRow}>
              <View style={styles.vCellLeft}>
                <Text style={styles.vitalsHeadLabel}>Vitals</Text>
                <Text style={styles.vitalsHeadDate}>{sentDateTime}</Text>
              </View>
              <View style={styles.vCell}><Text style={styles.vitalName}>BP</Text></View>
              <View style={styles.vCell}><Text style={styles.vitalName}>PULSE</Text></View>
              <View style={styles.vCell}><Text style={styles.vitalName}>SpO₂</Text></View>
              <View style={styles.vCell}><Text style={styles.vitalName}>TEMP</Text></View>
              <View style={styles.vCell}><Text style={styles.vitalName}>WEIGHT</Text></View>
              <View style={[styles.vCell, styles.vCellLast]}><Text style={styles.vitalName}>HEIGHT</Text></View>
            </View>
            {/* Row 2: values */}
            <View style={styles.vitalsValueRow}>
              <View style={styles.vCellLeft}>
                {/* spacer cell — values stack below header in the same column */}
                <Text>{" "}</Text>
              </View>
              <View style={styles.vCell}>
                <Text style={bp ? styles.vitalValue : [styles.vitalValue, styles.vitalEmpty]}>
                  {bp ?? "—"}
                </Text>
              </View>
              <View style={styles.vCell}>
                <Text style={data.pulse_bpm != null ? styles.vitalValue : [styles.vitalValue, styles.vitalEmpty]}>
                  {data.pulse_bpm ?? "—"}
                </Text>
              </View>
              <View style={styles.vCell}>
                <Text style={data.spo2_pct != null ? styles.vitalValue : [styles.vitalValue, styles.vitalEmpty]}>
                  {data.spo2_pct != null ? `${data.spo2_pct}%` : "—"}
                </Text>
              </View>
              <View style={styles.vCell}>
                <Text style={data.temp_c != null ? styles.vitalValue : [styles.vitalValue, styles.vitalEmpty]}>
                  {data.temp_c != null ? `${data.temp_c} °C` : "—"}
                </Text>
              </View>
              <View style={styles.vCell}>
                <Text style={data.patient_weight_kg != null ? styles.vitalValue : [styles.vitalValue, styles.vitalEmpty]}>
                  {data.patient_weight_kg != null ? `${data.patient_weight_kg} kg` : "—"}
                </Text>
              </View>
              <View style={[styles.vCell, styles.vCellLast]}>
                <Text style={data.height_cm != null ? styles.vitalValue : [styles.vitalValue, styles.vitalEmpty]}>
                  {data.height_cm != null ? `${data.height_cm} cm` : "—"}
                </Text>
              </View>
            </View>
          </View>

          {/* ============================ Diagnosis ======================== */}
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Diagnosis</Text>
            <View style={styles.sectionBody}>
              <Text>
                <Text style={styles.diagnosisStrong}>Provisional Diagnosis:</Text>
                {" "}
                {data.provisional_diagnosis ?? "—"}
              </Text>
            </View>
          </View>

          {/* ============================ Past Medical History ============= */}
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Past Medical History</Text>
            <View style={styles.sectionBody}>
              <Text>{data.past_medical_history ?? "—"}</Text>
            </View>
          </View>

          {/* ============================ Medication ======================= */}
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Medication</Text>
            {items.length === 0 ? (
              <Text style={styles.medsEmpty}>
                To be prescribed post investigation
              </Text>
            ) : (
              <View style={styles.medsTable}>
                <View style={styles.medsHead} fixed>
                  <Text style={[styles.medsHeadCell, styles.colNum]}>#</Text>
                  <Text style={[styles.medsHeadCell, styles.colDrug]}>DRUG</Text>
                  <Text style={[styles.medsHeadCell, styles.colDose]}>DOSE</Text>
                  <Text style={[styles.medsHeadCell, styles.colFreq]}>FREQUENCY</Text>
                  <Text style={[styles.medsHeadCell, styles.colDur]}>DURATION</Text>
                  <Text style={[styles.medsHeadCell, styles.colNotes]}>NOTES</Text>
                </View>
                {items.map((it) => (
                  <View key={it.ordinal} style={styles.medsRow} wrap={false}>
                    <Text style={[styles.medsCell, styles.colNum]}>{it.ordinal}</Text>
                    <View style={[styles.medsCell, styles.colDrug]}>
                      <Text style={styles.drugName}>{it.drug_name}</Text>
                      {it.composition ? (
                        <Text style={styles.drugComposition}>{it.composition}</Text>
                      ) : null}
                    </View>
                    <Text
                      style={
                        it.dose
                          ? [styles.medsCell, styles.colDose]
                          : [styles.medsCell, styles.colDose, styles.cellDash]
                      }
                    >
                      {it.dose ?? "—"}
                    </Text>
                    <Text
                      style={
                        it.frequency
                          ? [styles.medsCell, styles.colFreq]
                          : [styles.medsCell, styles.colFreq, styles.cellDash]
                      }
                    >
                      {it.frequency ?? "—"}
                    </Text>
                    <Text
                      style={
                        it.duration
                          ? [styles.medsCell, styles.colDur]
                          : [styles.medsCell, styles.colDur, styles.cellDash]
                      }
                    >
                      {it.duration ?? "—"}
                    </Text>
                    <Text
                      style={
                        it.instructions
                          ? [styles.medsCell, styles.colNotes]
                          : [styles.medsCell, styles.colNotes, styles.cellDash]
                      }
                    >
                      {it.instructions ?? "—"}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* ============================ Investigation ==================== */}
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Investigation</Text>
            <View style={styles.sectionBody}>
              {labTests.length === 0 ? (
                <Text style={{ color: PALETTE.inkMute }}>—</Text>
              ) : (
                labTests.map((t) => (
                  <View key={t.ordinal} style={styles.listRow}>
                    <Text>
                      {t.test_name}
                      {t.instructions ? ` (${t.instructions})` : ""}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </View>

          {/* ===================== Dietary & Lifestyle Advice + Signature == */}
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Dietary &amp; Lifestyle Advice</Text>
            <View style={styles.adviceRow}>
              <View style={styles.adviceLeft}>
                {adviceLines.length === 0 ? (
                  <Text style={{ color: PALETTE.inkMute }}>—</Text>
                ) : (
                  adviceLines.map((line, idx) => (
                    <View key={idx} style={styles.listRow}>
                      <Text>{line}</Text>
                    </View>
                  ))
                )}
              </View>

              <View style={styles.signatureBlock}>
                {signatureMode === "embedded" && signatureDataUrl ? (
                  // eslint-disable-next-line jsx-a11y/alt-text
                  <Image src={signatureDataUrl} style={styles.signatureImage} />
                ) : (
                  <View style={styles.signaturePlaceholder}>
                    <Text style={styles.signaturePlaceholderText}>
                      [ signature image ]
                    </Text>
                  </View>
                )}
                <Text style={styles.doctorName}>Dr {data.doctor_full_name}</Text>
                {data.doctor_qualification ? (
                  <Text style={styles.doctorQual}>{data.doctor_qualification}</Text>
                ) : null}
                {fmtDoctorReg(data) ? (
                  <Text style={styles.doctorReg}>{fmtDoctorReg(data)}</Text>
                ) : null}
              </View>
            </View>
          </View>

          {/* ============================ Footer band ====================== */}
          <View style={styles.footerBand}>
            <SanocareIcon size={45} />
            <View style={styles.footerCenter}>
              <Text style={styles.footerCompany}>
                SANOCARE TECH INNOVATIONS PRIVATE LIMITED
              </Text>
              <Text style={styles.footerContact}>
                eMail: contact@sanocare.in   Website: www.sanocare.in
              </Text>
              <Text style={styles.footerWhatsapp}>
                FOR APPOINTMENT CALL / WHATSAPP: +91 9760059900
              </Text>
              <Text style={styles.footerCin}>
                CIN Number: U86904DL2025PTC446725
              </Text>
            </View>
            <SanocareIcon size={45} />
          </View>

        </View>
      </Page>
    </Document>
  );
}
