// React-PDF document for a single Rx version.
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
// Inter is registered at the module level via the helpers in
// renderPrescriptionPdf.ts; this file does NOT re-register fonts (so it
// can be imported in a context where the TTFs aren't on disk).
//
// Layout: A4 portrait, single column. Conservative print-safe margins.
// Sanocare brand colour for the header band only; everything else stays
// black-on-white for legibility on cheap printers.

import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";

// -------- types --------------------------------------------------------

export type PrescriptionItemForPdf = {
  ordinal: number;
  drug_name: string;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
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

  // Patient snapshot (denormalised at draft time)
  patient_name: string;
  patient_age: number | null;
  patient_sex: "M" | "F" | "O" | "U" | null;
  patient_weight_kg: number | null;

  // Clinical body
  chief_complaint: string | null;
  provisional_diagnosis: string | null;
  items: PrescriptionItemForPdf[];
  general_advice: string | null;
  follow_up_advice: string | null;
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
};

// -------- styling ------------------------------------------------------

const PALETTE = {
  brand: "#0f766e", // Sanocare teal — header band + accents
  ink: "#0f172a", // body text (slate-900)
  muted: "#475569", // labels (slate-600)
  hairline: "#cbd5e1", // dividers (slate-300)
  surfaceAlt: "#f8fafc", // table header band (slate-50)
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Inter",
    fontSize: 10,
    color: PALETTE.ink,
    paddingTop: 36,
    paddingBottom: 56, // leave room for footer
    paddingLeft: 40,
    paddingRight: 40,
    lineHeight: 1.35,
  },

  // ----- header band
  brandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: 10,
    borderBottomWidth: 1.5,
    borderBottomColor: PALETTE.brand,
    marginBottom: 14,
  },
  brandLeft: { flexDirection: "column" },
  brandName: {
    fontSize: 18,
    fontWeight: "bold",
    color: PALETTE.brand,
    letterSpacing: 0.5,
  },
  brandTagline: { fontSize: 8.5, color: PALETTE.muted, marginTop: 1 },
  brandRight: {
    flexDirection: "column",
    alignItems: "flex-end",
  },
  rxBadge: {
    fontSize: 8,
    fontWeight: "bold",
    color: PALETTE.brand,
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  rxCode: { fontSize: 11, fontWeight: "bold" },
  rxMeta: { fontSize: 8.5, color: PALETTE.muted, marginTop: 1 },

  // ----- two-up identity row
  identityRow: { flexDirection: "row", gap: 12, marginBottom: 14 },
  identityCol: { flex: 1 },
  blockLabel: {
    fontSize: 7.5,
    fontWeight: "bold",
    color: PALETTE.muted,
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  identityName: { fontSize: 11, fontWeight: "bold" },
  identityLine: { fontSize: 9, color: PALETTE.muted, marginTop: 1 },

  // ----- clinical body sections
  section: { marginBottom: 12 },
  sectionLabel: {
    fontSize: 7.5,
    fontWeight: "bold",
    color: PALETTE.muted,
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  bodyText: { fontSize: 10 },

  // ----- Rx symbol + medications header
  rxSymbolRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    marginBottom: 4,
  },
  rxSymbol: {
    fontSize: 22,
    fontWeight: "bold",
    color: PALETTE.brand,
    marginRight: 6,
  },
  rxSymbolLabel: {
    fontSize: 8.5,
    color: PALETTE.muted,
    letterSpacing: 0.8,
  },

  // ----- medications table
  table: {
    borderWidth: 0.5,
    borderColor: PALETTE.hairline,
    marginTop: 2,
  },
  tableHead: {
    flexDirection: "row",
    backgroundColor: PALETTE.surfaceAlt,
    borderBottomWidth: 0.5,
    borderBottomColor: PALETTE.hairline,
  },
  tableHeadCell: {
    fontSize: 8,
    fontWeight: "bold",
    color: PALETTE.muted,
    letterSpacing: 0.5,
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: PALETTE.hairline,
  },
  tableRowLast: { borderBottomWidth: 0 },
  tableCell: {
    fontSize: 9.5,
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  // column widths (sum: 100)
  colOrdinal: { width: "5%" },
  colDrug: { width: "35%" },
  colDose: { width: "15%" },
  colFreq: { width: "18%" },
  colDuration: { width: "12%" },
  colInstr: { width: "15%" },

  // ----- signature
  signatureRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 28,
  },
  signatureBox: { width: 180, alignItems: "center" },
  signatureImage: { width: 140, height: 50, marginBottom: 2 },
  signaturePlaceholder: {
    width: 160,
    height: 40,
    borderBottomWidth: 0.75,
    borderBottomColor: PALETTE.ink,
    marginBottom: 4,
  },
  signatureCaption: { fontSize: 8, color: PALETTE.muted, textAlign: "center" },
  signatureName: { fontSize: 9.5, fontWeight: "bold", marginTop: 2, textAlign: "center" },
  signatureLine: { fontSize: 8, color: PALETTE.muted, textAlign: "center" },

  // ----- footer (absolute)
  footer: {
    position: "absolute",
    bottom: 28,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: PALETTE.hairline,
  },
  footerText: { fontSize: 7.5, color: PALETTE.muted },
  footerPageNum: { fontSize: 7.5, color: PALETTE.muted },

  // ----- watermark
  watermark: {
    position: "absolute",
    top: "40%",
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 70,
    color: "rgba(15, 118, 110, 0.07)",
    fontWeight: "bold",
    letterSpacing: 4,
  },
});

// -------- helpers ------------------------------------------------------

function formatPatientLine(d: PrescriptionPdfData): string {
  const parts: string[] = [];
  if (d.patient_age != null) parts.push(`Age ${d.patient_age}`);
  if (d.patient_sex) {
    const sexLabel = { M: "Male", F: "Female", O: "Other", U: "Unspecified" }[
      d.patient_sex
    ];
    parts.push(sexLabel);
  }
  if (d.patient_weight_kg != null) parts.push(`${d.patient_weight_kg} kg`);
  return parts.join(" · ");
}

function formatSentDate(iso: string | null): string {
  if (!iso) return "DRAFT — not yet sent";
  const d = new Date(iso);
  // dd Mmm yyyy — no time component, matches what a physical script
  // looks like.
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// -------- the document ------------------------------------------------

export function PrescriptionPdf({
  data,
  signatureMode,
  signatureDataUrl,
}: PrescriptionPdfProps) {
  const isDraft = data.sent_at_iso == null;
  const patientLine = formatPatientLine(data);
  const items = data.items.slice().sort((a, b) => a.ordinal - b.ordinal);

  return (
    <Document
      title={`Prescription ${data.prescription_code}`}
      author={data.doctor_full_name}
      creator="Sanocare"
      producer="Sanocare"
    >
      <Page size="A4" style={styles.page} wrap>
        {isDraft && <Text style={styles.watermark}>DRAFT</Text>}

        {/* ============================ Header ============================ */}
        <View style={styles.brandRow}>
          <View style={styles.brandLeft}>
            <Text style={styles.brandName}>SANOCARE</Text>
            <Text style={styles.brandTagline}>
              Doctor consultation · sanocare.in
            </Text>
          </View>
          <View style={styles.brandRight}>
            <Text style={styles.rxBadge}>PRESCRIPTION</Text>
            <Text style={styles.rxCode}>
              {data.prescription_code}
              {data.version > 1 ? `  ·  v${data.version}` : ""}
            </Text>
            <Text style={styles.rxMeta}>{formatSentDate(data.sent_at_iso)}</Text>
          </View>
        </View>

        {/* ============================ Identity ========================== */}
        <View style={styles.identityRow}>
          <View style={styles.identityCol}>
            <Text style={styles.blockLabel}>PATIENT</Text>
            <Text style={styles.identityName}>{data.patient_name}</Text>
            {patientLine ? (
              <Text style={styles.identityLine}>{patientLine}</Text>
            ) : null}
          </View>
          <View style={styles.identityCol}>
            <Text style={styles.blockLabel}>DOCTOR</Text>
            <Text style={styles.identityName}>{data.doctor_full_name}</Text>
            {data.doctor_qualification ? (
              <Text style={styles.identityLine}>{data.doctor_qualification}</Text>
            ) : null}
            {data.doctor_registration_no ? (
              <Text style={styles.identityLine}>
                Reg. {data.doctor_registration_no}
              </Text>
            ) : null}
          </View>
        </View>

        {/* ============================ Complaint ========================= */}
        {data.chief_complaint ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>CHIEF COMPLAINT</Text>
            <Text style={styles.bodyText}>{data.chief_complaint}</Text>
          </View>
        ) : null}

        {/* ============================ Diagnosis ========================= */}
        {data.provisional_diagnosis ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>PROVISIONAL DIAGNOSIS</Text>
            <Text style={styles.bodyText}>{data.provisional_diagnosis}</Text>
          </View>
        ) : null}

        {/* ============================ Rx symbol ========================= */}
        <View style={styles.rxSymbolRow}>
          <Text style={styles.rxSymbol}>℞</Text>
          <Text style={styles.rxSymbolLabel}>MEDICATIONS</Text>
        </View>

        {/* ============================ Medications ======================= */}
        <View style={styles.table}>
          <View style={styles.tableHead} fixed>
            <Text style={[styles.tableHeadCell, styles.colOrdinal]}>#</Text>
            <Text style={[styles.tableHeadCell, styles.colDrug]}>Drug</Text>
            <Text style={[styles.tableHeadCell, styles.colDose]}>Dose</Text>
            <Text style={[styles.tableHeadCell, styles.colFreq]}>Frequency</Text>
            <Text style={[styles.tableHeadCell, styles.colDuration]}>
              Duration
            </Text>
            <Text style={[styles.tableHeadCell, styles.colInstr]}>
              Instructions
            </Text>
          </View>
          {items.length === 0 ? (
            <View style={styles.tableRow}>
              <Text
                style={[
                  styles.tableCell,
                  { width: "100%", color: PALETTE.muted, fontStyle: "italic" },
                ]}
              >
                (no medications)
              </Text>
            </View>
          ) : (
            items.map((it, idx) => (
              <View
                key={it.ordinal}
                style={[
                  styles.tableRow,
                  idx === items.length - 1 ? styles.tableRowLast : {},
                ]}
                wrap={false}
              >
                <Text style={[styles.tableCell, styles.colOrdinal]}>
                  {it.ordinal}
                </Text>
                <Text style={[styles.tableCell, styles.colDrug]}>
                  {it.drug_name}
                </Text>
                <Text style={[styles.tableCell, styles.colDose]}>
                  {it.dose ?? "—"}
                </Text>
                <Text style={[styles.tableCell, styles.colFreq]}>
                  {it.frequency ?? "—"}
                </Text>
                <Text style={[styles.tableCell, styles.colDuration]}>
                  {it.duration ?? "—"}
                </Text>
                <Text style={[styles.tableCell, styles.colInstr]}>
                  {it.instructions ?? "—"}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* ============================ Advice ============================ */}
        {data.general_advice ? (
          <View style={[styles.section, { marginTop: 14 }]}>
            <Text style={styles.sectionLabel}>GENERAL ADVICE</Text>
            <Text style={styles.bodyText}>{data.general_advice}</Text>
          </View>
        ) : null}

        {data.follow_up_advice ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>FOLLOW-UP</Text>
            <Text style={styles.bodyText}>{data.follow_up_advice}</Text>
          </View>
        ) : null}

        {/* ============================ Signature ========================= */}
        <View style={styles.signatureRow} wrap={false}>
          <View style={styles.signatureBox}>
            {signatureMode === "embedded" && signatureDataUrl ? (
              // react-pdf's <Image> renders into a PDF — alt-text is
              // not part of its prop surface; the signature legibility
              // is the accessibility surface (signed name + reg. no.
              // below). Silence jsx-a11y for this element.
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={signatureDataUrl} style={styles.signatureImage} />
            ) : (
              <View style={styles.signaturePlaceholder} />
            )}
            <Text style={styles.signatureCaption}>
              {signatureMode === "embedded"
                ? "Digitally signed"
                : "Doctor's signature"}
            </Text>
            <Text style={styles.signatureName}>{data.doctor_full_name}</Text>
            {data.doctor_registration_no ? (
              <Text style={styles.signatureLine}>
                Reg. {data.doctor_registration_no}
              </Text>
            ) : null}
          </View>
        </View>

        {/* ============================ Footer ============================ */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Sanocare · sanocare.in · This is a computer-generated prescription.
          </Text>
          <Text
            style={styles.footerPageNum}
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
