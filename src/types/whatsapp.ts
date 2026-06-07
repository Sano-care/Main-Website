// Zod schemas for the inbound WhatsApp Cloud API webhook envelope.
//
// Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
//
// Design choices:
//   * Schemas are intentionally permissive (.passthrough / .catchall) — Meta
//     adds fields over time and an over-strict schema would 4xx valid traffic.
//     We validate the *shape we depend on* and preserve the rest for the
//     messages.raw_payload audit column.
//   * A single webhook may carry message events, status receipts (sent /
//     delivered / read), or both. Week 1 acts on text messages; everything
//     else is logged but never crashes the handler (Deliverable 1).

import { z } from "zod";

// ---------------------------------------------------------------------------
// Message types we recognise. Anything outside this set is normalised to
// "unsupported" so the orchestrator can log-and-skip without throwing.
// ---------------------------------------------------------------------------
export const WHATSAPP_MESSAGE_TYPES = [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "interactive",
  "button",
  "contacts",
  "reaction",
  "order",
  "system",
  "unsupported",
] as const;

export const TextBodySchema = z
  .object({
    body: z.string(),
  })
  .passthrough();

// One inbound message object inside changes[].value.messages[].
// `.passthrough()` keeps unknown fields for raw_payload.
export const WhatsAppMessageSchema = z
  .object({
    from: z.string(), // sender wa_id, digits only e.g. "919711977782"
    id: z.string(), // wamid... — used for idempotency
    timestamp: z.string(), // unix seconds, as a string
    type: z.string(),
    text: TextBodySchema.optional(),
    // Template quick-reply tap (type "button"): { payload, text }.
    button: z
      .object({ payload: z.string().optional(), text: z.string().optional() })
      .passthrough()
      .optional(),
    // Interactive reply (type "interactive"): button_reply / list_reply.
    interactive: z
      .object({
        type: z.string().optional(),
        button_reply: z
          .object({ id: z.string().optional(), title: z.string().optional() })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    // Reply context — for a button tap, context.id is the original (template)
    // message's wamid. This is how we map "Mark as Attended" back to its escalation.
    context: z
      .object({ id: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

// Status receipts (delivered/read/etc.). We don't act on these in Week 1 but
// must parse the envelope without error when they arrive.
export const WhatsAppStatusSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    timestamp: z.string(),
    recipient_id: z.string(),
  })
  .passthrough();

export const WhatsAppContactSchema = z
  .object({
    wa_id: z.string(),
    profile: z.object({ name: z.string() }).passthrough().optional(),
  })
  .passthrough();

export const ChangeValueSchema = z
  .object({
    messaging_product: z.string().optional(),
    metadata: z
      .object({
        display_phone_number: z.string().optional(),
        phone_number_id: z.string().optional(),
      })
      .passthrough()
      .optional(),
    contacts: z.array(WhatsAppContactSchema).optional(),
    messages: z.array(WhatsAppMessageSchema).optional(),
    statuses: z.array(WhatsAppStatusSchema).optional(),
  })
  .passthrough();

export const ChangeSchema = z
  .object({
    field: z.string().optional(),
    value: ChangeValueSchema,
  })
  .passthrough();

export const EntrySchema = z
  .object({
    id: z.string().optional(),
    changes: z.array(ChangeSchema).default([]),
  })
  .passthrough();

export const WebhookEnvelopeSchema = z
  .object({
    object: z.string(),
    entry: z.array(EntrySchema).default([]),
  })
  .passthrough();

export type WebhookEnvelope = z.infer<typeof WebhookEnvelopeSchema>;
export type WhatsAppMessage = z.infer<typeof WhatsAppMessageSchema>;
export type WhatsAppContact = z.infer<typeof WhatsAppContactSchema>;

// ---------------------------------------------------------------------------
// Normalised inbound message — the flat shape the orchestrator consumes.
// ---------------------------------------------------------------------------
export interface NormalizedInbound {
  /** WhatsApp message id (wamid...). Idempotency key. */
  providerMessageId: string;
  /** Sender phone in E.164 with leading +, e.g. +919711977782. */
  phone: string;
  /** Recognised message type, or "unsupported". */
  type: (typeof WHATSAPP_MESSAGE_TYPES)[number];
  /** Text body for type === "text"; null otherwise. */
  text: string | null;
  /** Sender display name from the contacts array, if present. */
  contactName: string | null;
  /** Cloud API phone_number_id the message arrived on. */
  phoneNumberId: string | null;
  /** Unix seconds (string, as Meta sends it). */
  timestamp: string;
  /** Quick-reply / interactive button payload, if this is a button tap. */
  buttonPayload: string | null;
  /** Button display text/title, if present. */
  buttonText: string | null;
  /** context.id — the wamid of the message being replied to (button taps). */
  contextId: string | null;
  /** The original message object, for messages.raw_payload. */
  raw: WhatsAppMessage;
}

function toE164(waId: string): string {
  const digits = waId.replace(/[^\d]/g, "");
  return digits.startsWith("+") ? digits : `+${digits}`;
}

function normalizeType(
  type: string,
): (typeof WHATSAPP_MESSAGE_TYPES)[number] {
  return (WHATSAPP_MESSAGE_TYPES as readonly string[]).includes(type)
    ? (type as (typeof WHATSAPP_MESSAGE_TYPES)[number])
    : "unsupported";
}

/**
 * Flatten a validated webhook envelope into the inbound messages we care
 * about. Status receipts and message-less changes yield nothing. Never
 * throws on unknown message types — they surface as type "unsupported".
 */
export function extractInboundMessages(
  envelope: WebhookEnvelope,
): NormalizedInbound[] {
  const out: NormalizedInbound[] = [];

  for (const entry of envelope.entry) {
    for (const change of entry.changes) {
      const value = change.value;
      const messages = value.messages ?? [];
      if (messages.length === 0) continue;

      const phoneNumberId = value.metadata?.phone_number_id ?? null;
      const contactsByWaId = new Map<string, string>();
      for (const c of value.contacts ?? []) {
        if (c.profile?.name) contactsByWaId.set(c.wa_id, c.profile.name);
      }

      for (const msg of messages) {
        const buttonPayload =
          msg.button?.payload ??
          msg.interactive?.button_reply?.id ??
          null;
        const buttonText =
          msg.button?.text ??
          msg.interactive?.button_reply?.title ??
          null;
        out.push({
          providerMessageId: msg.id,
          phone: toE164(msg.from),
          type: normalizeType(msg.type),
          text: msg.type === "text" ? (msg.text?.body ?? null) : null,
          contactName: contactsByWaId.get(msg.from) ?? null,
          phoneNumberId,
          timestamp: msg.timestamp,
          buttonPayload,
          buttonText,
          contextId: msg.context?.id ?? null,
          raw: msg,
        });
      }
    }
  }

  return out;
}
