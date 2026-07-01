// React-PDF document for a Sanocare payment receipt (R4 Part B).
//
// Reuses the SAME stack as the prescription PDF (@react-pdf/renderer +
// renderToBuffer, see ../../rx/pdf/) — no second PDF library. Like the Rx
// renderer it ships with @react-pdf's built-in PDF standard fonts (Helvetica
// for body, Courier for the monospaced money/code) and registers NO TTFs, so
// the serverless bundle stays lean. The brand mark is the same inline butterfly
// <Svg><Path> the Rx uses (paths duplicated here so the locked prescription
// renderer stays untouched), plus the "Sanocare" wordmark — that mark+wordmark
// lockup is how the prescription PDF represents the logo too (@react-pdf renders
// SVG via Path primitives, not by importing a .svg file).
//
// COMPLIANCE NOTE: this is a customer-facing financial document carrying the
// legal entity + GSTIN. The exact legal wording — especially the GST-exempt
// footnote and the "payment receipt, not a tax invoice" framing — is
// FOUNDER / CA-REVIEW-REQUIRED before it ships. The strings live here, in one
// place, for that review.

import { Document, Page, Text, View, StyleSheet, Svg, Path } from "@react-pdf/renderer";

import { SUPPORT_EMAIL, PHONE_DISPLAY } from "@/lib/contact";

// -------- types --------------------------------------------------------

export type ReceiptPdfData = {
  /** bookings.booking_code (SAN-B-XXXXX) — the receipt number. */
  receipt_no: string;
  /** Pre-formatted capture date (IST), e.g. "12 Jun 2026". */
  date_display: string;
  /** Bill-to: the customer's name. */
  bill_to: string;
  /** Human service label, e.g. "Lab Test at Home". */
  service_label: string;
  /** Pre-formatted amount, e.g. "₹1,200.50" (Indian grouping). */
  amount_display: string;
  /** CAPTURED → Paid, REFUNDED → Refunded. NOT_DUE never reaches here. */
  status: "CAPTURED" | "REFUNDED";
  /** Full razorpay_payment_id — acceptable on the customer's own scoped receipt. */
  payment_ref: string | null;
};

// -------- legal copy (FOUNDER / CA REVIEW REQUIRED) --------------------

const ENTITY = {
  name: "SANOCARE TECH INNOVATIONS PRIVATE LIMITED",
  cin: "U86904DL2025PTC446725",
  regdOffice:
    "1666/B2, 3rd Floor, Gali 2, Govindpuri Extension, Kalkaji, New Delhi 110019",
  gstin: "07ABPCS9713B1Z5",
} as const;

/** GST-exempt footnote — exact wording pending founder/CA sign-off. */
const GST_FOOTNOTE =
  "Healthcare services exempt from GST; this is a payment receipt, not a tax invoice.";

// -------- palette (brand) ---------------------------------------------

const PALETTE = {
  ink: "#0F172A",
  inkSoft: "#334155",
  inkMute: "#64748B",
  border: "#1F2937",
  hair: "#94A3B8",
  brand: "#2B81FF", // wordmark, butterfly, accents
  coral: "#F4845A", // single sparing accent (status pill border on refund)
  paper: "#FFFFFF",
  headerBg: "#F1F5F9",
} as const;

// -------- styling (pt units) ------------------------------------------

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: PALETTE.ink,
    backgroundColor: PALETTE.paper,
    paddingTop: 34,
    paddingLeft: 34,
    paddingRight: 34,
    paddingBottom: 120,
    lineHeight: 1.4,
  },
  docBorder: {
    flexDirection: "column",
    borderWidth: 0.6,
    borderColor: PALETTE.border,
  },

  // ----- HEADER BAND -----
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 0.6,
    borderBottomColor: PALETTE.border,
  },
  headerLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerBrand: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
    color: PALETTE.brand,
    letterSpacing: 0.4,
  },
  headerRight: {
    flex: 1,
    alignItems: "flex-end",
  },
  headerTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: PALETTE.ink,
    letterSpacing: 0.4,
  },

  // ----- ENTITY BLOCK -----
  entity: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderBottomWidth: 0.6,
    borderBottomColor: PALETTE.border,
    backgroundColor: PALETTE.headerBg,
  },
  entityName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9.5,
    color: PALETTE.ink,
    letterSpacing: 0.2,
  },
  entityLine: {
    fontSize: 8.5,
    color: PALETTE.inkSoft,
    marginTop: 1.6,
  },
  entityMono: {
    fontFamily: "Courier",
    fontSize: 8.5,
    color: PALETTE.inkSoft,
  },

  // ----- META TABLE -----
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
    paddingVertical: 5,
    paddingHorizontal: 14,
    alignItems: "baseline",
  },
  metaCellLeft: {
    borderRightWidth: 0.6,
    borderRightColor: PALETTE.border,
  },
  metaLabel: {
    width: 86,
    fontFamily: "Helvetica-Bold",
    color: PALETTE.ink,
    fontSize: 9.5,
  },
  metaValue: {
    flex: 1,
    color: PALETTE.ink,
    fontSize: 9.5,
  },
  metaValueMono: {
    flex: 1,
    fontFamily: "Courier",
    color: PALETTE.ink,
    fontSize: 9.5,
  },

  // ----- LINE-ITEM TABLE -----
  lineHead: {
    flexDirection: "row",
    backgroundColor: PALETTE.headerBg,
    borderBottomWidth: 0.5,
    borderBottomColor: PALETTE.hair,
  },
  lineHeadDesc: {
    flex: 1,
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: PALETTE.inkSoft,
    letterSpacing: 0.4,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  lineHeadAmt: {
    width: 130,
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: PALETTE.inkSoft,
    letterSpacing: 0.4,
    paddingVertical: 6,
    paddingHorizontal: 14,
    textAlign: "right",
  },
  lineRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: PALETTE.hair,
  },
  lineDesc: {
    flex: 1,
    fontSize: 10,
    color: PALETTE.ink,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  lineAmt: {
    width: 130,
    fontFamily: "Courier-Bold",
    fontSize: 11,
    color: PALETTE.ink,
    paddingVertical: 9,
    paddingHorizontal: 14,
    textAlign: "right",
  },
  totalRow: {
    flexDirection: "row",
    borderTopWidth: 0.6,
    borderTopColor: PALETTE.border,
  },
  totalLabel: {
    flex: 1,
    fontFamily: "Helvetica-Bold",
    fontSize: 10.5,
    color: PALETTE.ink,
    paddingVertical: 9,
    paddingHorizontal: 14,
    textAlign: "right",
  },
  totalAmt: {
    width: 130,
    fontFamily: "Courier-Bold",
    fontSize: 12,
    color: PALETTE.brand,
    paddingVertical: 9,
    paddingHorizontal: 14,
    textAlign: "right",
  },

  // ----- STATUS + REF ROW -----
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderBottomWidth: 0.6,
    borderBottomColor: PALETTE.border,
    gap: 10,
  },
  statusPillPaid: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: "#047857",
    backgroundColor: "#ECFDF5",
    borderWidth: 0.6,
    borderColor: "#047857",
    borderRadius: 3,
    paddingVertical: 2.5,
    paddingHorizontal: 7,
    letterSpacing: 0.5,
  },
  statusPillRefunded: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: "#B45309",
    backgroundColor: "#FFFBEB",
    borderWidth: 0.6,
    borderColor: PALETTE.coral,
    borderRadius: 3,
    paddingVertical: 2.5,
    paddingHorizontal: 7,
    letterSpacing: 0.5,
  },
  refLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: PALETTE.inkSoft,
  },
  refValue: {
    fontFamily: "Courier",
    fontSize: 9,
    color: PALETTE.inkSoft,
  },

  // ----- GST FOOTNOTE -----
  gstNote: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    fontSize: 8.5,
    color: PALETTE.inkMute,
    fontFamily: "Helvetica-Oblique",
  },

  // ----- FOOTER BAND -----
  footerBand: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 0.6,
    borderColor: PALETTE.border,
    borderRadius: 3,
  },
  footerCenter: {
    flex: 1,
    alignItems: "center",
    textAlign: "center",
  },
  footerCompany: {
    fontFamily: "Helvetica-Bold",
    color: PALETTE.brand,
    fontSize: 9,
    letterSpacing: 0.2,
    marginBottom: 2.6,
    textAlign: "center",
  },
  footerContact: {
    color: PALETTE.ink,
    fontSize: 8.5,
    textAlign: "center",
  },
});

// -------- inline butterfly SVG ----------------------------------------
// Same two kidney-shaped paths as the Rx SanocareIcon (public/logo.svg),
// duplicated here so the locked prescription renderer stays untouched.

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

// -------- the document ------------------------------------------------

export function ReceiptPdf({ data }: { data: ReceiptPdfData }) {
  const isRefund = data.status === "REFUNDED";
  return (
    <Document
      title={`Sanocare Receipt ${data.receipt_no}`}
      author="Sanocare"
      creator="Sanocare"
      producer="Sanocare"
    >
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.docBorder}>
          {/* ===== Header band ===== */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <SanocareIcon size={34} />
              <Text style={styles.headerBrand}>Sanocare</Text>
            </View>
            <View style={styles.headerRight}>
              <Text style={styles.headerTitle}>Payment Receipt</Text>
            </View>
          </View>

          {/* ===== Entity block (legal) ===== */}
          <View style={styles.entity}>
            <Text style={styles.entityName}>{ENTITY.name}</Text>
            <Text style={styles.entityLine}>
              CIN <Text style={styles.entityMono}>{ENTITY.cin}</Text>
              {"   ·   "}
              GSTIN <Text style={styles.entityMono}>{ENTITY.gstin}</Text>
            </Text>
            <Text style={styles.entityLine}>
              Registered office: {ENTITY.regdOffice}
            </Text>
          </View>

          {/* ===== Meta table ===== */}
          <View style={styles.metaTable}>
            <View style={styles.metaRow}>
              <View style={[styles.metaCell, styles.metaCellLeft]}>
                <Text style={styles.metaLabel}>Receipt No:</Text>
                <Text style={styles.metaValueMono}>{data.receipt_no}</Text>
              </View>
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>Date:</Text>
                <Text style={styles.metaValue}>{data.date_display}</Text>
              </View>
            </View>
            <View style={styles.metaRow}>
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>Billed To:</Text>
                <Text style={styles.metaValue}>{data.bill_to}</Text>
              </View>
            </View>
          </View>

          {/* ===== Line item table ===== */}
          <View style={styles.lineHead}>
            <Text style={styles.lineHeadDesc}>DESCRIPTION</Text>
            <Text style={styles.lineHeadAmt}>AMOUNT</Text>
          </View>
          <View style={styles.lineRow}>
            <Text style={styles.lineDesc}>{data.service_label}</Text>
            <Text style={styles.lineAmt}>{data.amount_display}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>
              {isRefund ? "Amount refunded" : "Amount paid"}
            </Text>
            <Text style={styles.totalAmt}>{data.amount_display}</Text>
          </View>

          {/* ===== Status + payment reference ===== */}
          <View style={styles.statusRow}>
            <Text style={isRefund ? styles.statusPillRefunded : styles.statusPillPaid}>
              {isRefund ? "REFUNDED" : "PAID"}
            </Text>
            {data.payment_ref ? (
              <Text>
                <Text style={styles.refLabel}>Payment Ref: </Text>
                <Text style={styles.refValue}>{data.payment_ref}</Text>
              </Text>
            ) : null}
          </View>

          {/* ===== GST footnote (founder/CA review) ===== */}
          <Text style={styles.gstNote}>{GST_FOOTNOTE}</Text>
        </View>

        {/* ===== Footer band (page-pinned) ===== */}
        <View style={styles.footerBand} fixed>
          <SanocareIcon size={40} />
          <View style={styles.footerCenter}>
            <Text style={styles.footerCompany}>{ENTITY.name}</Text>
            <Text style={styles.footerContact}>
              {`${SUPPORT_EMAIL}   ·   ${PHONE_DISPLAY}`}
            </Text>
          </View>
          <SanocareIcon size={40} />
        </View>
      </Page>
    </Document>
  );
}
