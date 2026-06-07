// WhatsApp Cloud API outbound client (low-level HTTP).
//
// This module only knows how to PUT bytes on the wire. The permanent opt-out
// send-block (safety rule #4) is enforced one layer up, in the outbound
// dispatcher (db.ts → dispatchTextMessage), so that NOTHING can call the Cloud
// API without passing the opt_out gate first.
//
// Env conventions reused from the existing OTP integration
// (src/lib/otp/whatsapp.ts): WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN,
// WHATSAPP_API_VERSION (defaults to v21.0).

import { log } from "@/lib/whatsapp/log";

const GRAPH_BASE = "https://graph.facebook.com";

// WhatsApp hard-limits text bodies at 4096 chars; we split below that with
// headroom. Smart sentence-boundary splitting arrives in Week 2 — Week 1 does a
// safe hard chunk so a long echo can never 400.
const MAX_CHARS = 4000;

export class CloudApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CloudApiError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new CloudApiError(`Missing required env var: ${name}`);
  return value;
}

function chunk(text: string, size: number): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}

interface MetaMessagesResponse {
  messages?: { id: string }[];
  error?: { message: string; type: string; code: number };
}

/**
 * Send a free-form text message to a phone number (digits-only E.164, no '+').
 * Splits bodies over 4000 chars into multiple sequential messages. Returns the
 * provider message id of the LAST chunk. Throws CloudApiError on any failure.
 *
 * NOTE: callers must go through dispatchTextMessage (db.ts), which enforces the
 * opt-out block and records the outbound message + audit rows.
 */
export async function sendTextMessage(input: {
  to: string;
  body: string;
}): Promise<{ providerMessageId?: string }> {
  const phoneNumberId = requireEnv("WHATSAPP_PHONE_NUMBER_ID");
  const accessToken = requireEnv("WHATSAPP_ACCESS_TOKEN");
  const apiVersion = process.env.WHATSAPP_API_VERSION ?? "v21.0";
  const to = input.to.replace(/[^\d]/g, "");

  let lastId: string | undefined;
  for (const part of chunk(input.body, MAX_CHARS)) {
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: part },
    };

    let response: Response;
    try {
      response = await fetch(
        `${GRAPH_BASE}/${apiVersion}/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
    } catch (cause) {
      log.error("cloud-api network error", cause);
      throw new CloudApiError("Network error reaching WhatsApp Cloud API");
    }

    const json = (await response
      .json()
      .catch(() => ({}))) as MetaMessagesResponse;

    if (!response.ok || json.error) {
      // json.error.message may include detail but never the token.
      throw new CloudApiError(
        `WhatsApp send failed (${response.status}): ${
          json.error?.message ?? "unknown"
        }`,
        response.status,
      );
    }

    lastId = json.messages?.[0]?.id ?? lastId;
  }

  return { providerMessageId: lastId };
}

/**
 * Send a pre-approved template message. Used for the ops handoff
 * (aarogya_lead_alert) to the founder's WhatsApp, and for OTP post-cutover.
 *
 * bodyParams fill the {{1}}..{{n}} placeholders in order. quickReplyPayload, if
 * given, is attached to the first quick-reply button so the inbound button tap
 * echoes it back (we use it to carry the escalation_id). Returns the send wamid.
 */
export async function sendTemplateMessage(input: {
  to: string;
  templateName: string;
  languageCode?: string;
  bodyParams: string[];
  quickReplyPayload?: string;
}): Promise<{ providerMessageId?: string }> {
  const phoneNumberId = requireEnv("WHATSAPP_PHONE_NUMBER_ID");
  const accessToken = requireEnv("WHATSAPP_ACCESS_TOKEN");
  const apiVersion = process.env.WHATSAPP_API_VERSION ?? "v21.0";
  const to = input.to.replace(/[^\d]/g, "");

  const components: Record<string, unknown>[] = [
    {
      type: "body",
      parameters: input.bodyParams.map((text) => ({ type: "text", text })),
    },
  ];
  if (input.quickReplyPayload !== undefined) {
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: 0,
      parameters: [{ type: "payload", payload: input.quickReplyPayload }],
    });
  }

  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: input.templateName,
      language: { code: input.languageCode ?? "en" },
      components,
    },
  };

  let response: Response;
  try {
    response = await fetch(
      `${GRAPH_BASE}/${apiVersion}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
  } catch (cause) {
    log.error("cloud-api template network error", cause);
    throw new CloudApiError("Network error reaching WhatsApp Cloud API");
  }

  const json = (await response.json().catch(() => ({}))) as MetaMessagesResponse;
  if (!response.ok || json.error) {
    throw new CloudApiError(
      `WhatsApp template send failed (${response.status}): ${
        json.error?.message ?? "unknown"
      }`,
      response.status,
    );
  }

  return { providerMessageId: json.messages?.[0]?.id };
}
