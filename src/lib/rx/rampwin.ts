// Rampwin WhatsApp sender for the e-prescription delivery.
//
// Parallel module to src/lib/consult/rampwin.ts and src/lib/otp/rampwin.ts.
// Same API endpoint and transport, different template — each Meta-
// approved template has a fixed component shape so we keep one sender
// module per template.
//
// TWO TEMPLATE SHAPES, BEHIND A FEATURE FLAG
// ------------------------------------------
// Meta approves "media header" (document attachment) templates more
// strictly than body-only templates. We support both, switchable via
// env so the founder can ship body-only first (lower approval risk)
// and migrate to document-header later without a code change.
//
//   RAMPWIN_RX_TEMPLATE_DOCUMENT_HEADER_OK = 'true' (or 'yes' / '1')
//     -> use the document-header template:
//          name = RAMPWIN_RX_TEMPLATE_NAME_DOCUMENT (default
//                 'sanocare_rx_document')
//          header: document; parameters: [{ document: { link: <signed
//                  https URL to the PDF>, filename: "<rx-code>.pdf" }}]
//          body parameters (positional, one var):
//                  {{1}} patient first name
//          NO URL button.
//
//   RAMPWIN_RX_TEMPLATE_DOCUMENT_HEADER_OK = anything else / unset
//     -> use the body-only template (default):
//          name = RAMPWIN_RX_TEMPLATE_NAME_BODY (default
//                 'sanocare_rx_link')
//          body parameters (positional, three vars):
//                  {{1}} patient first name
//                  {{2}} doctor full name
//                  {{3}} full https://sanocare.in/rx/<token> URL
//          NO URL button — the full URL sits in the body so WhatsApp
//          renders it as a tappable link inline (same pattern as the
//          consult-join template).
//
// In either mode, send failures throw RampwinRxDeliveryError; the
// server action catches the throw and persists pdf_storage_path +
// patient_view_token regardless so ops can deliver the link manually
// via the /ops/prescriptions/[rx_code] surface.
//
// Required env vars (already set; same as OTP / consult paths):
//   RAMPWIN_API_KEY            — secret
//   RAMPWIN_CHANNEL_ID         — channel id
// Optional env vars:
//   RAMPWIN_API_URL                         — full POST URL (defaults to
//                                              the documented endpoint)
//   RAMPWIN_RX_TEMPLATE_DOCUMENT_HEADER_OK  — feature flag (default false)
//   RAMPWIN_RX_TEMPLATE_NAME_BODY           — default 'sanocare_rx_link'
//   RAMPWIN_RX_TEMPLATE_NAME_DOCUMENT       — default 'sanocare_rx_document'
//   RAMPWIN_RX_TEMPLATE_LANG                — default 'en'
//   NEXT_PUBLIC_SITE_URL                    — default 'https://sanocare.in';
//                                              used to build the Rx URL.

const DEFAULT_API_URL =
  "https://api.rampwin.com/api/messages/send?dontShowInChatList=false";
const DEFAULT_SITE_URL = "https://sanocare.in";

export class RampwinRxDeliveryError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "RampwinRxDeliveryError";
  }
}

export interface SendRxLinkInput {
  /** E.164-normalised phone, e.g. "+919711977782". */
  phone: string;
  /** Patient's full display name; first word used as the WhatsApp greeting var. */
  patientName: string;
  /** Doctor's full display name (only used in the body-only shape). */
  doctorName: string;
  /** The 32-hex patient-view token. The Rx URL is built from it. */
  patientViewToken: string;
  /**
   * Required only when the document-header template is enabled. A
   * publicly-fetchable HTTPS URL Meta can pull during render; pass a
   * short-lived signed URL from the prescriptions bucket. Meta caches
   * the asset on first send so 1-hour TTL is sufficient. Ignored in
   * body-only mode.
   */
  signedPdfUrl?: string | null;
  /** Used to render the document-header filename (Meta shows this in chat). */
  prescriptionCode?: string;
}

export interface SendRxLinkResult {
  providerMessageId?: string;
  /** Which template path was actually used — surfaced for audit logging. */
  templateShape: "body-only" | "document-header";
}

interface RampwinResponse {
  success?: boolean;
  data?: { messageId?: string };
  message?: string;
  error?: string | { message?: string };
}

/**
 * Single source of truth for the RAMPWIN_RX_TEMPLATE_DOCUMENT_HEADER_OK
 * flag. Both this module and every caller that has to *prepare* for
 * document-header mode (signing the PDF URL ahead of the sendRxLink
 * call) must agree on the answer — if they disagree (e.g. one trims
 * trailing whitespace and the other doesn't), sends fail hard:
 * sendRxLink throws "signedPdfUrl was not supplied" while the caller
 * believed body-only mode was active and skipped signing.
 *
 * Exported so src/app/doctor/_actions/prescription.ts and
 * src/app/ops/(shell)/prescriptions/actions.ts can call this directly
 * instead of re-implementing the parse.
 */
export function isRxDocumentHeaderEnabled(): boolean {
  const v = process.env.RAMPWIN_RX_TEMPLATE_DOCUMENT_HEADER_OK?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  return first || fullName.trim() || "there";
}

/**
 * Send the patient their prescription link via Rampwin WhatsApp.
 *
 * Expected templates (founder/BSP responsibility — configure to match):
 *
 *   Body-only (default; lower Meta approval risk):
 *     name:     RAMPWIN_RX_TEMPLATE_NAME_BODY (default 'sanocare_rx_link')
 *     category: 'UTILITY'
 *     body parameters (positional, three vars):
 *       {{1}} patient first name (e.g. "Anjali")
 *       {{2}} doctor full name   (e.g. "Dr Ravi Kapoor")
 *       {{3}} full Rx URL        (e.g. "https://sanocare.in/rx/<token>")
 *     NO URL button — full URL sits in the body so WhatsApp linkifies it.
 *
 *   Document-header (enable via env flag once Meta-approved):
 *     name:     RAMPWIN_RX_TEMPLATE_NAME_DOCUMENT (default 'sanocare_rx_document')
 *     category: 'UTILITY'
 *     header: document
 *       parameters: [{ document: { link: <signedPdfUrl>, filename: "<rx_code>.pdf" } }]
 *     body parameters (positional, one var):
 *       {{1}} patient first name
 *     NO URL button — the PDF is attached.
 *
 * The fetch shape mirrors src/lib/consult/rampwin.ts — only the
 * components array differs.
 */
export async function sendRxLink(input: SendRxLinkInput): Promise<SendRxLinkResult> {
  const apiKey = requireEnv("RAMPWIN_API_KEY");
  const channelId = requireEnv("RAMPWIN_CHANNEL_ID");
  const apiUrl = process.env.RAMPWIN_API_URL?.trim() || DEFAULT_API_URL;
  const templateLang =
    process.env.RAMPWIN_RX_TEMPLATE_LANG?.trim() || "en";

  // Rampwin expects "91XXXXXXXXXX" (12 digits, country-code prefix, no `+`).
  const phoneNumber = input.phone.replace(/\D/g, "");
  if (!/^91\d{10}$/.test(phoneNumber)) {
    throw new RampwinRxDeliveryError(
      `Rampwin received an unexpected phone format: ${input.phone}`,
    );
  }

  const useDocumentHeader = isRxDocumentHeaderEnabled();
  const templateShape: SendRxLinkResult["templateShape"] = useDocumentHeader
    ? "document-header"
    : "body-only";

  let templateName: string;
  let components: unknown[];

  if (useDocumentHeader) {
    if (!input.signedPdfUrl) {
      throw new RampwinRxDeliveryError(
        "Document-header template enabled but signedPdfUrl was not supplied. Pass a short-lived HTTPS URL to the Rx PDF.",
      );
    }
    if (!/^https:\/\//i.test(input.signedPdfUrl)) {
      throw new RampwinRxDeliveryError(
        "signedPdfUrl must be an https:// URL — Meta refuses non-https media links.",
      );
    }
    templateName =
      process.env.RAMPWIN_RX_TEMPLATE_NAME_DOCUMENT?.trim() ||
      "sanocare_rx_document";

    components = [
      {
        type: "header",
        parameters: [
          {
            type: "document",
            document: {
              link: input.signedPdfUrl,
              filename: `${input.prescriptionCode ?? "prescription"}.pdf`,
            },
          },
        ],
      },
      {
        type: "body",
        parameters: [{ type: "text", text: firstName(input.patientName) }],
      },
    ];
  } else {
    templateName =
      process.env.RAMPWIN_RX_TEMPLATE_NAME_BODY?.trim() || "sanocare_rx_link";

    // Build the full Rx URL the BSP template carries inline as {{3}}.
    const siteUrl = (
      process.env.NEXT_PUBLIC_SITE_URL?.trim() || DEFAULT_SITE_URL
    ).replace(/\/+$/, "");
    const rxUrl = `${siteUrl}/rx/${input.patientViewToken}`;

    components = [
      {
        type: "body",
        parameters: [
          { type: "text", text: firstName(input.patientName) },
          { type: "text", text: input.doctorName },
          { type: "text", text: rxUrl },
        ],
      },
    ];
  }

  const body = {
    channel_id: channelId,
    phone_number: phoneNumber,
    hide_from_chat: false,
    template: {
      name: templateName,
      language: { policy: "deterministic", code: templateLang },
      category: "UTILITY",
      components,
    },
  };

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new RampwinRxDeliveryError("Network error reaching Rampwin.", cause);
  }

  const json = (await response.json().catch(() => ({}))) as RampwinResponse;
  if (!response.ok || json.success !== true) {
    const detail =
      typeof json.error === "string"
        ? json.error
        : json.error?.message ?? json.message ?? "unknown";
    throw new RampwinRxDeliveryError(
      `Rampwin Rx send failed (HTTP ${response.status}, template ${templateShape}): ${detail}`,
      json,
    );
  }

  return {
    providerMessageId: json.data?.messageId,
    templateShape,
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new RampwinRxDeliveryError(`Missing required env var: ${name}.`);
  }
  return v;
}
