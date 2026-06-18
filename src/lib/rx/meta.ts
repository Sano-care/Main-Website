// T-Prong-B C3 — Meta-direct successor to src/lib/rx/rampwin.ts.
// Two template shapes behind a single env flag:
//
//   sanocare_rx_link (body-only, default)   — 5 body vars, URL in body
//                                              literal "sanocare.in/rx/{{5}}"
//   sanocare_rx_document (document-header)  — 1 body var, PDF attached
//                                              via header (uses the
//                                              sendTemplateMessage
//                                              headerDocument param
//                                              shipped in C1)
//
// THROWS MetaRxDeliveryError on failure (matches Rampwin contract — both
// call sites instanceof-check the error class; C3 updates both catches).
//
// Env vars (new):
//   WHATSAPP_RX_ENABLED                       — must be exact "true"
//   WHATSAPP_RX_TEMPLATE_DOCUMENT_HEADER_OK   — feature flag, default
//                                                false → body-only mode
//
// The RAMPWIN_RX_TEMPLATE_NAME_BODY / _DOCUMENT / _LANG overrides are
// dropped — template names are code constants.

import { formatIST } from "@/lib/time/formatIST";
import {
  sendTemplateMessage,
  CloudApiError,
} from "@/lib/whatsapp/cloud-api";

const TEMPLATE_BODY_ONLY = "sanocare_rx_link";
const TEMPLATE_DOCUMENT_HEADER = "sanocare_rx_document";

export class MetaRxDeliveryError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "MetaRxDeliveryError";
  }
}

export interface SendRxLinkInput {
  /** E.164-normalised phone, e.g. "+919711977782". */
  phone: string;
  /** Patient's full display name; first word used as {{1}}. */
  patientName: string;
  /** Doctor's full display name (used as {{2}} in body-only template). */
  doctorName: string;
  /** 32-hex patient-view token — body-only template {{5}} (literal
   *  contains "sanocare.in/rx/{{5}}"). */
  patientViewToken: string;
  /**
   * ISO timestamp of the consultation. Formatted as "27 May 2026" for
   * body-only {{3}}. REQUIRED in body-only mode; ignored in
   * document-header mode.
   */
  consultationDateIso?: string;
  /**
   * Prescription code (SAN-RX-NNNNN). REQUIRED in body-only mode (sent
   * as {{4}}). In document-header mode it doubles as the filename Meta
   * surfaces in chat.
   */
  prescriptionCode?: string;
  /**
   * Required only when document-header mode is enabled. Publicly-fetchable
   * HTTPS URL Meta pulls during render. 1-hour TTL is sufficient (Meta
   * caches on first send). Ignored in body-only mode.
   */
  signedPdfUrl?: string | null;
}

export interface SendRxLinkResult {
  providerMessageId?: string;
  templateShape: "body-only" | "document-header";
}

/**
 * Single source of truth for the WHATSAPP_RX_TEMPLATE_DOCUMENT_HEADER_OK
 * flag. Exported so both call sites can pre-check + sign the PDF URL
 * when document-header mode is active.
 *
 * Accepts "true" | "1" | "yes" (case-insensitive).
 */
export function isRxDocumentHeaderEnabled(): boolean {
  const v =
    process.env.WHATSAPP_RX_TEMPLATE_DOCUMENT_HEADER_OK?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  return first || fullName.trim() || "there";
}

export async function sendRxLink(
  input: SendRxLinkInput,
): Promise<SendRxLinkResult> {
  if (process.env.WHATSAPP_RX_ENABLED !== "true") {
    throw new MetaRxDeliveryError(
      "WhatsApp Rx send disabled — WHATSAPP_RX_ENABLED must be \"true\".",
    );
  }

  // Phone → "91XXXXXXXXXX" digits-only (sendTemplateMessage re-strips
  // but we validate early for a clearer error).
  const phoneNumber = input.phone.replace(/\D/g, "");
  if (!/^91\d{10}$/.test(phoneNumber)) {
    throw new MetaRxDeliveryError(
      `Unexpected phone format: ${input.phone}`,
    );
  }

  const useDocumentHeader = isRxDocumentHeaderEnabled();
  const templateShape: SendRxLinkResult["templateShape"] = useDocumentHeader
    ? "document-header"
    : "body-only";

  try {
    if (useDocumentHeader) {
      if (!input.signedPdfUrl) {
        throw new MetaRxDeliveryError(
          "Document-header template enabled but signedPdfUrl was not supplied. Pass a short-lived HTTPS URL to the Rx PDF.",
        );
      }
      if (!/^https:\/\//i.test(input.signedPdfUrl)) {
        throw new MetaRxDeliveryError(
          "signedPdfUrl must be an https:// URL — Meta refuses non-https media links.",
        );
      }
      const filename = `${input.prescriptionCode ?? "prescription"}.pdf`;
      const result = await sendTemplateMessage({
        to: phoneNumber,
        templateName: TEMPLATE_DOCUMENT_HEADER,
        bodyParams: [firstName(input.patientName)],
        headerDocument: { link: input.signedPdfUrl, filename },
      });
      return { providerMessageId: result.providerMessageId, templateShape };
    }

    // Body-only mode — 5 positional vars (hotfix 2026-05-27).
    if (!input.consultationDateIso) {
      throw new MetaRxDeliveryError(
        "Body-only template requires consultationDateIso (used as {{3}}).",
      );
    }
    if (!input.prescriptionCode) {
      throw new MetaRxDeliveryError(
        "Body-only template requires prescriptionCode (used as {{4}}).",
      );
    }
    const consultationDate = formatIST(input.consultationDateIso, "dateLong");
    const result = await sendTemplateMessage({
      to: phoneNumber,
      templateName: TEMPLATE_BODY_ONLY,
      bodyParams: [
        firstName(input.patientName),       // {{1}}
        input.doctorName,                    // {{2}}
        consultationDate,                    // {{3}}
        input.prescriptionCode,              // {{4}}
        input.patientViewToken,              // {{5}}
      ],
    });
    return { providerMessageId: result.providerMessageId, templateShape };
  } catch (cause) {
    if (cause instanceof MetaRxDeliveryError) throw cause;
    if (cause instanceof CloudApiError) {
      throw new MetaRxDeliveryError(
        `Meta Cloud API rejected Rx send (${templateShape}): ${cause.message}`,
        cause,
      );
    }
    throw new MetaRxDeliveryError(
      `Unexpected Rx send failure (${templateShape})`,
      cause,
    );
  }
}
