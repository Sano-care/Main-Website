// Aarogya conversation viewer — shared types + pure helpers (no DB, no React,
// so they're safe to import from server (data.ts), client components, AND tests).

export type ConvFilter =
  | "all"
  | "active"
  | "escalated"
  | "emergency"
  | "errors"
  | "optout";

export const FILTERS: { key: ConvFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active 24h" },
  { key: "escalated", label: "Escalated" },
  { key: "emergency", label: "Emergency" },
  { key: "errors", label: "Errors" },
  { key: "optout", label: "Opt-out" },
];

export interface ConversationRow {
  id: string;
  phone: string;
  state: string;
  serviceIntent: string | null;
  escalationStatus: string;
  optOut: boolean;
  /** ISO timestamp of the most recent activity (msg in/out or row creation). */
  lastActivityAt: string;
  /** Within the 24h active window — computed server-side at fetch time so the
   *  client never calls Date.now() during render (keeps render pure). */
  isActive: boolean;
  /** Pre-rendered relative-time label ("5m" / "2h" / "3d"), also server-baked. */
  timeSinceLabel: string;
  lastMessage: { direction: "inbound" | "outbound"; content: string } | null;
  messageCount: number;
  hasEmergency: boolean;
  hasEscalation: boolean;
  hasError: boolean;
}

export interface MessageItem {
  kind: "message";
  id: string;
  direction: "inbound" | "outbound";
  content: string;
  contentType: string;
  model: string | null;
  tokensOut: number | null;
  createdAt: string;
}

export interface AuditItem {
  kind: "audit";
  id: string;
  eventType: string;
  eventData: Record<string, unknown>;
  createdAt: string;
}

export type ThreadItem = MessageItem | AuditItem;

export interface ConversationMeta {
  id: string;
  phone: string;
  state: string;
  serviceIntent: string | null;
  escalationStatus: string;
  optOut: boolean;
  firstSeenAt: string;
  messageCount: number;
  totalTokensOut: number;
  modelsUsed: string[];
}

// Audit events hidden from the thread overlay — they 1:1 duplicate the
// message bubbles and would just be noise.
export const HIDDEN_AUDIT_TYPES = new Set([
  "agent_response",
  "message_received",
  "message_echoed",
]);

export const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** True if the conversation's last activity is within the 24h active window.
 *  Called server-side (data.ts) with the request-time `now`. */
export function isWithinActiveWindow(lastActivityAt: string, now: number): boolean {
  return now - new Date(lastActivityAt).getTime() < ACTIVE_WINDOW_MS;
}

/** Compact relative-time label. Called server-side so render stays pure. */
export function relativeTime(iso: string, now: number): string {
  const m = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Filter predicate — shared by the live counts and the rendered list.
 *  The time-relative "active" case reads the server-baked `isActive` flag,
 *  so this stays a pure function of its inputs. */
export function matchesFilter(c: ConversationRow, filter: ConvFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "active":
      return c.isActive;
    case "escalated":
      return c.hasEscalation || c.escalationStatus !== "none";
    case "emergency":
      return c.hasEmergency;
    case "errors":
      return c.hasError;
    case "optout":
      return c.optOut;
  }
}

/** Case-insensitive search over phone digits + last-message content. */
export function matchesSearch(c: ConversationRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const phoneDigits = c.phone.replace(/\D/g, "");
  if (phoneDigits.includes(q.replace(/\D/g, "")) && q.replace(/\D/g, "")) return true;
  if (c.phone.toLowerCase().includes(q)) return true;
  if (c.lastMessage?.content.toLowerCase().includes(q)) return true;
  return false;
}

/**
 * Mask the middle digits of an Indian number for screenshot-safe display:
 * "+91 98765 43210" -> "+91xxxxxx3210". Keeps the country code + last 4.
 */
export function redactPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "+91xxxxxx____";
  return `+91xxxxxx${digits.slice(-4)}`;
}

/** Tel-link form: strip to digits, ensure +91 country code. */
export function telHref(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("91") ? `tel:+${d}` : `tel:+91${d}`;
}
