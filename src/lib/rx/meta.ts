// T-Prong-B C3 (shell, signatures only) — Meta-direct successor to
// src/lib/rx/rampwin.ts. Two template shapes behind a single env flag:
//
//   sanocare_rx_link (body-only, default)   — 5 body vars, URL in body
//   sanocare_rx_document (document-header)  — 1 body var, PDF attached
//                                             via header (depends on
//                                             sendTemplateMessage's new
//                                             optional headerDocument
//                                             param shipped in C1)
//
// THROWS (matches Rampwin contract):
//   - MetaRxDeliveryError on any failure. The 2 call sites
//     (doctor/_actions/prescription.ts + ops/(shell)/prescriptions/actions.ts)
//     instanceof-check this so we keep the error-class export with a
//     renamed identifier. Original class was RampwinRxDeliveryError —
//     C3 renames + updates both catch sites in the same commit.
//
// Env vars (new):
//   WHATSAPP_RX_ENABLED                   — "true" to allow sends
//   WHATSAPP_RX_TEMPLATE_DOCUMENT_HEADER_OK — feature flag, default false
//
// The RAMPWIN_RX_TEMPLATE_NAME_BODY / _DOCUMENT / _LANG overrides are
// dropped — template names are code constants now.
//
// Body-only template body literal embeds the URL: "sanocare.in/rx/{{5}}"
// — we send the TOKEN only as {{5}}, not the full URL. Same contract as
// Rampwin original.

export class MetaRxDeliveryError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "MetaRxDeliveryError";
  }
}

export interface SendRxLinkInput {
  /** E.164-normalised phone, e.g. "+919711977782". */
  phone: string;
  /** Patient's full display name; first word used as the {{1}} greeting. */
  patientName: string;
  /** Doctor's full display name (used as {{2}} in the body-only template). */
  doctorName: string;
  /** 32-hex patient-view token — used as {{5}} in the body-only template
   *  (the template body literal contains "sanocare.in/rx/{{5}}"). */
  patientViewToken: string;
  /**
   * ISO timestamp of the consultation. Formatted as "27 May 2026" (en-IN,
   * IST) for body-only {{3}}. REQUIRED in body-only mode; ignored in
   * document-header mode.
   */
  consultationDateIso?: string;
  /**
   * Prescription code, e.g. "SAN-RX-00003". REQUIRED in body-only mode
   * (sent as {{4}}). In document-header mode it doubles as the filename
   * Meta surfaces in chat.
   */
  prescriptionCode?: string;
  /**
   * Required only when WHATSAPP_RX_TEMPLATE_DOCUMENT_HEADER_OK is on. A
   * publicly-fetchable HTTPS URL Meta can pull during render. Ignored in
   * body-only mode.
   */
  signedPdfUrl?: string | null;
}

export interface SendRxLinkResult {
  providerMessageId?: string;
  /** Which template path was actually used — surfaced for audit logging. */
  templateShape: "body-only" | "document-header";
}

/**
 * Single source of truth for the WHATSAPP_RX_TEMPLATE_DOCUMENT_HEADER_OK
 * flag. Exported so both call sites can pre-check and sign the PDF URL
 * when document-header mode is active.
 *
 * Accepts "true" | "1" | "yes" (case-insensitive). Matches the
 * Rampwin original's parse semantics.
 */
export function isRxDocumentHeaderEnabled(): boolean {
  const v =
    process.env.WHATSAPP_RX_TEMPLATE_DOCUMENT_HEADER_OK?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/**
 * Send the patient their prescription via WhatsApp Cloud API (Meta direct).
 *
 * Body-only mode (default): sanocare_rx_link template, 5 body vars
 *   {{1}} firstName(patientName)
 *   {{2}} doctorName
 *   {{3}} formatIST(consultationDateIso, "dateLong") — "27 May 2026"
 *   {{4}} prescriptionCode
 *   {{5}} patientViewToken — template literal renders sanocare.in/rx/{{5}}
 *
 * Document-header mode: sanocare_rx_document template, 1 body var
 *   header: document { link: signedPdfUrl, filename: "<rx_code>.pdf" }
 *   {{1}} firstName(patientName)
 *
 * Throws MetaRxDeliveryError on:
 *   - Missing WHATSAPP_RX_ENABLED (=== "true" required)
 *   - Phone not in "91XXXXXXXXXX" digits-only form (after normalize)
 *   - Body-only mode + missing consultationDateIso or prescriptionCode
 *   - Document-header mode + missing/non-https signedPdfUrl
 *   - Meta Cloud API failure (CloudApiError wrapped/rethrown)
 */
export async function sendRxLink(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- shell only
  input: SendRxLinkInput,
): Promise<SendRxLinkResult> {
  throw new MetaRxDeliveryError("sendRxLink: implementation lands in C3");
}
