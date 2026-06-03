// Redaction-aware logging for the WhatsApp agent.
//
// Safety rules (architecture §3.2, handover "CRITICAL safety rules"):
//   #1 Secrets (access token, app secret, Anthropic key, DB url, service-role
//      key) must NEVER appear in logs, traces, Sentry or Slack.
//   #6 Phone numbers are redacted everywhere except the database. Format keeps
//      the country prefix and last 4 digits: +91xxxxxx7782.
//
// Everything that logs in the agent goes through `log` here, and any phone
// number that leaves the DB layer for a log/Slack/Sentry sink goes through
// `maskPhone` first.

const SECRET_ENV_KEYS = [
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_VERIFY_TOKEN",
  "ANTHROPIC_API_KEY",
  "DATABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SLACK_LEADS_WEBHOOK_URL",
  "SLACK_ALERTS_WEBHOOK_URL",
] as const;

/**
 * Mask a phone number for non-DB sinks: keep the leading "+CC" and the last 4
 * digits, replace the rest with 'x'. "+919711977782" -> "+91xxxxxx7782".
 * Defensive: anything too short to mask meaningfully is fully masked.
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "[no-phone]";
  const trimmed = phone.trim();
  if (trimmed.length <= 7) return "+" + "x".repeat(Math.max(trimmed.length, 1));
  const head = trimmed.slice(0, 3); // "+91"
  const last4 = trimmed.slice(-4);
  const masked = "x".repeat(trimmed.length - head.length - 4);
  return `${head}${masked}${last4}`;
}

/**
 * Scrub known secret values and bearer tokens out of an arbitrary string.
 * Reads the live env values so rotated secrets are still caught.
 */
export function redactSecrets(input: string): string {
  let out = input;
  for (const key of SECRET_ENV_KEYS) {
    const value = process.env[key];
    if (value && value.length >= 6) {
      out = out.split(value).join(`[REDACTED:${key}]`);
    }
  }
  // Catch-all for Authorization headers / bearer tokens that may be inlined.
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
  return out;
}

function format(args: unknown[]): string {
  const parts = args.map((a) => {
    if (typeof a === "string") return a;
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  });
  return redactSecrets(parts.join(" "));
}

const PREFIX = "[whatsapp]";

export const log = {
  info(...args: unknown[]): void {
    console.log(PREFIX, format(args));
  },
  warn(...args: unknown[]): void {
    console.warn(PREFIX, format(args));
  },
  error(...args: unknown[]): void {
    console.error(PREFIX, format(args));
  },
};
