// Slack ops alerts via incoming webhooks (architecture §9.3, Deliverable 5).
//
// Two channels:
//   SLACK_ALERTS_WEBHOOK_URL -> #sanocare-alerts (emergencies, escalations)
//   SLACK_LEADS_WEBHOOK_URL  -> #sanocare-leads  (qualified leads; Week 3+)
//
// PII policy note (flagged in decisions.md): Deliverable 5 requires the full
// phone number in the alert *body* (ops must be able to call an emergency back)
// while keeping only the last 4 digits in the *title*. Safety rule #6's general
// "no full numbers in Slack" is specialised by this explicit deliverable; the
// title is masked, the body carries the full number. Awaiting founder
// confirmation.
//
// Incoming webhooks return only "ok" (no message ts), so slack_message_id is
// not captured here; it stays null on the escalation row.

import { log, maskPhone } from "@/lib/whatsapp/log";

function siteBase(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    "https://sanocare.in"
  );
}

/** ISO-8601 timestamp in IST (+05:30), e.g. 2026-06-03T14:22:05+05:30. */
function istIso(ms: number): string {
  // 'sv-SE' yields "YYYY-MM-DD HH:mm:ss"; swap the space for 'T' and pin offset.
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ms));
  return `${parts.replace(" ", "T")}+05:30`;
}

type SlackBlock = Record<string, unknown>;

async function postBlocks(
  webhookUrl: string | undefined,
  channelLabel: string,
  fallbackText: string,
  blocks: SlackBlock[],
): Promise<boolean> {
  if (!webhookUrl) {
    log.warn(`slack webhook for ${channelLabel} not configured; skipping`);
    return false;
  }
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: fallbackText, blocks }),
    });
    if (!res.ok) {
      log.error(`slack post to ${channelLabel} failed`, res.status);
      return false;
    }
    return true;
  } catch (err) {
    log.error(`slack post to ${channelLabel} threw`, err);
    return false;
  }
}

export interface EmergencyAlertInput {
  conversationId: string;
  /** Full E.164 phone, e.g. +919711977782. */
  phone: string;
  /** Full inbound message text. */
  messageText: string;
  /** Inbound timestamp (ms since epoch). */
  timestampMs: number;
  /** First matched emergency keyword, for ops context. */
  keyword?: string;
}

/**
 * Fire a P1 emergency alert to #sanocare-alerts. Best-effort: returns true on a
 * 2xx from Slack, false otherwise (logged). Never throws.
 */
export async function sendEmergencyAlert(
  input: EmergencyAlertInput,
): Promise<boolean> {
  const convoUrl = `${siteBase()}/admin/conversations/${input.conversationId}`;
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🚨 EMERGENCY — ${maskPhone(input.phone)}`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "<!channel> Possible medical emergency detected by Aarogya. " +
          "112 response sent automatically. *Call the patient now.*",
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Phone:*\n${input.phone}` },
        { type: "mrkdwn", text: `*Time (IST):*\n${istIso(input.timestampMs)}` },
        {
          type: "mrkdwn",
          text: `*Trigger keyword:*\n${input.keyword ?? "n/a"}`,
        },
        { type: "mrkdwn", text: `*Priority:*\np1` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Inbound message:*\n>${input.messageText.replace(/\n/g, "\n>")}`,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Conversation:*\n<${convoUrl}|Open in admin>` },
    },
  ];

  return postBlocks(
    process.env.SLACK_ALERTS_WEBHOOK_URL,
    "#sanocare-alerts",
    `🚨 EMERGENCY from ${maskPhone(input.phone)} — call now`,
    blocks,
  );
}

export interface LeadAlertInput {
  conversationId: string;
  phone: string;
  name?: string | null;
  area?: string | null;
  serviceIntent?: string | null;
  urgency?: string | null;
  summary?: string | null;
}

/**
 * Qualified-lead card for #sanocare-leads. Stubbed for Week 1 (not wired into
 * the orchestrator until Week 3 qualification lands) but implemented so the
 * channel + format are ready. Best-effort; never throws.
 */
export async function sendLeadAlert(input: LeadAlertInput): Promise<boolean> {
  const convoUrl = `${siteBase()}/admin/conversations/${input.conversationId}`;
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `✅ Qualified lead — ${maskPhone(input.phone)}`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Phone:*\n${input.phone}` },
        { type: "mrkdwn", text: `*Name:*\n${input.name ?? "—"}` },
        { type: "mrkdwn", text: `*Area:*\n${input.area ?? "—"}` },
        { type: "mrkdwn", text: `*Service:*\n${input.serviceIntent ?? "—"}` },
        { type: "mrkdwn", text: `*Urgency:*\n${input.urgency ?? "—"}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Summary:*\n${input.summary ?? "—"}\n\n<${convoUrl}|Open in admin>`,
      },
    },
  ];

  return postBlocks(
    process.env.SLACK_LEADS_WEBHOOK_URL,
    "#sanocare-leads",
    `Qualified lead from ${maskPhone(input.phone)}`,
    blocks,
  );
}
